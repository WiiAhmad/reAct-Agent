# Reminder Tool Exposure Design

## Ringkasan

Perbaikan ini menargetkan bug pada alur reminder multi-turn di mana balasan klarifikasi seperti `jam 5` atau `sekali saja` bisa kehilangan akses ke `tdai_create_job`. Akar masalahnya ada pada gating tool di layer agent: `tdai_create_job` hanya diekspos jika pesan user **saat ini** cocok dengan heuristik scheduling, walaupun konteks reminder sebelumnya masih ada di riwayat chat.

Desain yang dipilih adalah membuat `tdai_create_job` **selalu tersedia di mode chat**, lalu membiarkan model memutuskan kapan tool itu dipakai berdasarkan konteks penuh, system prompt, dan schema tool. Pembatasan untuk mode `autonomous` tetap dipertahankan.

## Masalah Saat Ini

Di `src/agent/react-agent.ts`, eksposur `tdai_create_job` bergantung pada `shouldExposeSchedulingTools(input)`, yang hanya membaca isi pesan user terakhir. Akibatnya:

- turn awal seperti `ingatkan saya untuk meeting` masih benar, karena tool tersedia dan agent boleh bertanya dulu
- tetapi balasan lanjutan seperti `jam 5` atau `sekali saja` bisa kehilangan `tdai_create_job`
- model masih memiliki konteks reminder dari memory + recent messages, tetapi tidak bisa mengeksekusi pembuatan job karena tool sudah lebih dulu disembunyikan

Ini menciptakan mismatch antara konteks percakapan yang lengkap dan daftar tool yang diberikan ke model.

## Tujuan

- `tdai_create_job` selalu tersedia pada semua turn chat
- balasan klarifikasi reminder tetap bisa melanjutkan alur scheduling tanpa harus mengulang kata-kata seperti `ingatkan` atau `besok`
- mode `autonomous` tetap tidak boleh melihat `tdai_create_job`
- perubahan tetap kecil, fokus, dan tidak mengubah service scheduler, database, atau memory backend

## Perubahan Desain

### 1. Ubah gating tool di agent runtime

Di `src/agent/react-agent.ts`, daftar tool akan tetap difilter untuk mode `autonomous`, tetapi filter khusus yang menyembunyikan `tdai_create_job` berdasarkan `shouldExposeSchedulingTools(...)` akan dihapus.

Sesudah perubahan:

- mode `chat`: `tdai_create_job` selalu ada
- mode `autonomous`: `tdai_create_job` tetap disembunyikan
- `telegram_send_message` juga tetap disembunyikan di mode `autonomous`

### 2. Hapus heuristik yang tidak lagi diperlukan

Jika setelah perubahan `shouldExposeSchedulingTools(...)` tidak lagi dipakai, fungsi itu dihapus dari `src/agent/react-agent.ts` agar tidak meninggalkan dead code.

### 3. Pertahankan kontrol perilaku di prompt + schema

Kapan `tdai_create_job` dipanggil tidak akan ditentukan oleh filter tambahan di runtime. Kontrol tetap berasal dari:

- instruksi sistem di `src/agent/prompts/system.ts`
- schema + validasi tool di `src/tools/local.ts`
- reasoning model berdasarkan recent messages dan layered memory context

Artinya, model tetap boleh memilih bertanya klarifikasi jika detail jadwal belum cukup, tetapi akses ke tool tidak lagi hilang hanya karena pesan terakhir terlalu pendek.

## Data Flow Baru

1. User mengirim pesan chat.
2. `runReactAgent(...)` memuat system prompt, recent messages, dan recall seperti biasa.
3. Registry tool dilist untuk mode chat.
4. `tdai_create_job` tetap ikut dalam daftar tool tanpa memeriksa isi pesan terakhir.
5. Model membaca konteks penuh:
   - jika detail reminder belum cukup, model bertanya klarifikasi
   - jika detail sudah cukup, model boleh memanggil `tdai_create_job`
6. Scheduler, service job, dan penyimpanan data berjalan tanpa perubahan.

## Pengujian

File utama yang perlu diperbarui adalah `tests/memory/agent-runtime.test.ts`.

### Test yang perlu diubah

Test yang saat ini mengharapkan `tdai_create_job` tersembunyi pada unrelated follow-up chat turn perlu disesuaikan, karena asumsi desainnya berubah. Setelah perubahan ini, tool akan selalu tersedia pada mode chat.

### Test yang perlu dipastikan

- turn chat klarifikasi seperti `jam 5` tetap melihat `tdai_create_job`
- turn chat seperti `sekali saja` tetap melihat `tdai_create_job`
- turn chat yang mengulang sinyal scheduling eksplisit seperti `besok jam 5` tetap lulus
- mode `autonomous` tetap **tidak** melihat `tdai_create_job`
- test runtime agent lainnya tetap hijau

## Risiko dan Tradeoff

### Tradeoff yang diterima

Semua turn chat akan memiliki 1 tool tambahan (`tdai_create_job`) dibanding sebelumnya.

### Kenapa tradeoff ini diterima

- perubahan jadi lebih konsisten dengan konteks percakapan penuh
- menghilangkan false negative pada turn klarifikasi reminder
- jauh lebih sederhana dibanding menambah state flow reminder khusus
- scope perubahan kecil dan mudah diverifikasi

## Out of Scope

Perubahan ini **tidak** mencakup:

- mengubah logika scheduler
- mengubah `AutonomousJobService`
- mengubah schema database
- memperbaiki pemilihan tool pertama agar selalu memilih `tdai_create_job` daripada `tdai_memory_search`
- menambah state eksplisit untuk reminder wizard

## Kriteria Selesai

Perubahan dianggap selesai jika:

- `tdai_create_job` selalu tersedia di mode chat
- turn klarifikasi seperti `jam 5` dan `sekali saja` tidak lagi kehilangan akses ke tool scheduling
- mode `autonomous` tetap tidak mendapat akses ke `tdai_create_job`
- test yang relevan lulus
- tidak ada perubahan ke layer scheduler, database, atau memory service
