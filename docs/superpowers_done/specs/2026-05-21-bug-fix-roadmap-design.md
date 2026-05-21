# Bug Fix Roadmap Design

## Ringkasan

Roadmap ini memecah 13 bug terbuka yang sudah diverifikasi ke 4 workstream dan 3 phase eksekusi. Tujuan utamanya adalah menutup celah authorization/privacy lintas chat terlebih dahulu, lalu memperbaiki correctness scheduler dan ownership flow, lalu menyelesaikan bug konsistensi data yang tersisa.

Dokumen ini juga menetapkan bahwa `docs/bugs/2026-05-21-verified-bug-audit.md` adalah bug ledger kanonik yang harus diperbarui di perubahan yang sama setiap kali sebuah bug diperbaiki.

## Source references

- Verified bug ledger: `docs/bugs/2026-05-21-verified-bug-audit.md`
- Chat-mode tool exposure: `src/agent/react-agent.ts`, `src/tools/local.ts`
- Memory summary and shared-chat rendering: `src/bot/bot.ts`, `src/bot/ui/renderers.ts`, `src/bot/conversations/memory-update.ts`
- Job ownership and mutation flow: `src/services/autonomous-jobs.ts`, `src/bot/conversations/job-detail.ts`
- Task canvas and recall flow: `src/memory/recall/service.ts`, `src/memory/core/service.ts`, `src/memory/backends/sqlite/backend.ts`
- Autonomous scheduler flow: `src/cron/autonomous.ts`, `src/services/schedules.ts`, `src/config.ts`
- Generated skill and memory maintenance flow: `src/memory/offload/l4.ts`, `src/memory/pipeline/coordinator.ts`, `src/memory/backends/sqlite/store.ts`
- Existing regression coverage to preserve and extend: `tests/memory/agent-runtime.test.ts`, `tests/memory/tools.test.ts`, `tests/services/autonomous-jobs.test.ts`, `tests/cron/autonomous-helpers.test.ts`, `tests/services/schedules.test.ts`, `tests/cron/scheduler.test.ts`

## Masalah saat ini

Bug yang tersisa tidak membentuk satu perubahan kecil. Mereka tersebar ke beberapa subsystem yang relatif independen:

1. trust boundary shared chat versus private chat
2. task ownership versus offloaded tool evidence
3. recurring job semantics and time calculations
4. generated artifact consistency and maintenance checkpoints

Kalau semua bug ini dipaksa masuk ke satu implementation plan, hasilnya akan terlalu besar, menyentuh terlalu banyak file sekaligus, dan sulit diverifikasi per phase. Karena itu roadmap ini memisahkan desain level-program dari execution plan level-phase.

## Tujuan

- Menetapkan satu roadmap perbaikan untuk semua bug terbuka yang sudah diverifikasi.
- Menentukan prioritas phase yang jelas berdasarkan risk dan dependency.
- Menetapkan aturan pembaruan `docs/bugs/2026-05-21-verified-bug-audit.md` sebagai source of truth selama campaign perbaikan.
- Menjadikan phase 1 cukup kecil untuk dieksekusi dengan satu implementation plan yang kohesif.

## Non-goals

Roadmap ini tidak:

- menggabungkan semua bug ke satu implementation batch
- mendesain ulang arsitektur bot di luar bug yang sudah diverifikasi
- menambah fitur produk baru
- membuat dokumen status tambahan per bug; ledger utama tetap satu file audit yang sama

## Workstream roadmap

### Workstream A — shared-chat security/privacy

Mencakup bug-bug berikut:
- `telegram_send_message` dapat mengirim ke `chat_id` arbitrer di chat mode
- autonomous job management bersifat chat-scoped sehingga user lain bisa mengubah job orang lain
- Memory summary dapat membocorkan persona/recall data di shared chat
- active task canvas masih bisa bocor antar user dalam chat yang sama

**Shared root cause:** beberapa boundary penting masih diikat ke `chatId` atau UI surface saat ini, padahal data dan aksi seharusnya dibatasi oleh actor yang sedang berinteraksi dan tipe chat tempat UI dibuka.

**Desired end state:**
- chat-mode tools tidak bisa mengirim lintas chat tanpa alur otorisasi eksplisit
- daftar/detail/mutasi job tidak bisa menyentuh resource milik user lain
- memory-sensitive screens tidak tampil di shared chat
- pembacaan active task canvas yang mempengaruhi recall/judgment harus user-scoped

### Workstream B — task/memory ownership

Mencakup bug-bug berikut:
- completion-turn tool evidence kehilangan task ownership
- kembali dari Memory Update mereset displayed draft count ke `0`

**Shared root cause:** state yang dipakai untuk UI atau offload dipotong terlalu dini saat turn selesai, atau dibangun ulang tanpa semua field yang dibutuhkan.

**Desired end state:**
- completion-turn tool output tetap melekat ke task yang baru diselesaikan
- semua jalur render Memory summary menggunakan sumber data draft count yang konsisten

### Workstream C — scheduler semantics

Mencakup bug-bug berikut:
- hybrid one-shot jobs dapat mengirim ulang fixed reminder setelah partial failure
- `tdai_create_job` membuat recurring jobs menjadi single-run secara default
- edit `once -> interval/cron` mempertahankan stale one-run cap
- `last_finished_at` dicatat terlalu awal
- cron memakai host time, bukan `APP_TIMEZONE`

**Shared root cause:** beberapa field scheduler (`max_runs`, `last_finished_at`, cron timing) diperlakukan dengan default atau anchor yang tidak cocok dengan semantics recurring jobs.

**Desired end state:**
- recurring jobs benar-benar recurring kecuali caller secara eksplisit memberi cap
- transisi antar schedule mode tidak membawa state satu-kali yang tidak diinginkan
- next-run timing dihitung dari finish time yang benar dan timezone aplikasi yang benar
- one-shot retry behavior tidak menduplikasi fixed text yang sudah terkirim

### Workstream D — consistency/integrity

Mencakup bug-bug berikut:
- generated skill drafts bisa overwrite file yang sama sambil count terus naik
- store-backed maintenance bisa skip rows dengan timestamp millisecond yang sama

**Shared root cause:** identifier dan checkpoint saat ini tidak cukup stabil untuk mewakili multiple rows/artifacts yang valid pada waktu yang sama.

**Desired end state:**
- generated draft persistence tidak silently overwrite draft lama sambil tetap menghitungnya sebagai draft terpisah
- maintenance checkpoint tidak kehilangan rows pada timestamp yang sama

## Execution phases

### Phase 1 — Shared-chat security/privacy

Phase pertama hanya mengerjakan Workstream A:
- batasi `telegram_send_message` agar tidak menjadi cross-chat send path di normal chat mode
- ubah job listing/detail/mutation agar mengikuti ownership actor
- cegah Memory summary yang sensitif tampil di shared chat
- hapus remaining `chat_id`-only active task canvas read yang mempengaruhi recall/judgment

**Why first:** ini adalah cluster dengan severity tertinggi karena menyangkut privacy leak dan unauthorized mutation across users.

### Phase 2 — Task/memory ownership + scheduler semantics

Phase kedua mengerjakan Workstream B dan C:
- task ownership untuk completion-turn offload
- konsistensi draft count di Memory summary
- seluruh semantics recurring jobs, retry, finish timestamp, dan timezone

**Why second:** perubahan ini penting untuk correctness dan data quality, tetapi risk-nya di bawah cross-chat authorization/privacy issues.

### Phase 3 — Consistency/integrity

Phase ketiga mengerjakan Workstream D:
- generated skill persistence collisions
- same-timestamp checkpoint skipping

**Why third:** bug ini penting untuk robustness jangka panjang, tetapi tidak setinggi phase 1 dan 2 dari sisi user-visible harm.

## Bug ledger update contract

`docs/bugs/2026-05-21-verified-bug-audit.md` adalah live bug ledger untuk semua phase dalam roadmap ini.

### Update rule

Setiap perubahan yang memperbaiki bug wajib memperbarui ledger tersebut di commit/perubahan yang sama.

### Allowed statuses per bug entry

- `Open`
- `Partial`
- `Fixed in current tree`

### Required ledger updates per bug fix

Setiap bug entry yang disentuh harus diperbarui dengan:
- `Status`
- ringkas `Fix summary`
- `Changed code` references
- `Verification` references
- `Notes` bila fix-nya partial atau sengaja dibatasi scope phase

### Required ledger updates at file level

Header audit yang merangkum jumlah open/fixed dan executive summary juga harus disesuaikan bila status bug berubah.

### Why one file

Roadmap ini sengaja memakai satu live ledger agar tidak ada drift antara code fixes, verification evidence, dan status bug yang dilaporkan.

## Verification strategy

Setiap bug fix di semua phase harus memenuhi empat lapis verifikasi:

1. **Targeted regression coverage**  
   Tambah atau perbarui test yang gagal sebelum fix dan lulus setelah fix. Test harus sempit dan langsung mengunci broken boundary yang sebenarnya.

2. **Relevant suite verification**  
   Jalankan test file yang relevan untuk subsystem yang disentuh, bukan hanya satu assertion baru.

3. **Behavior verification**  
   Pastikan perilaku user-visible benar-benar berubah sesuai tujuan fix, terutama untuk boundary shared-chat versus private-chat.

4. **Bug ledger verification**  
   Perbarui `docs/bugs/2026-05-21-verified-bug-audit.md` pada perubahan yang sama dan sertakan evidence verifikasi.

## Partial-fix policy

Status `Partial` hanya boleh dipakai jika sebuah perubahan memang sengaja menutup sebagian jalur bug tetapi masih menyisakan path yang diketahui.

Jika `Partial` dipakai, entry bug harus menjelaskan:
- bagian mana yang sudah diperbaiki
- bagian mana yang masih terbuka
- kenapa sisanya tidak diselesaikan pada phase itu
- verifikasi apa yang sudah ada untuk bagian yang selesai

Jika akar masalah sudah dihapus penuh dan regression coverage sudah ada, status harus dinaikkan ke `Fixed in current tree`.

## Phase completion criteria

Sebuah phase baru dianggap selesai jika:
- setiap bug dalam phase itu berstatus `Fixed in current tree` atau `Partial` dengan sisa scope yang jelas
- test yang relevan lulus
- bug ledger dan ringkasan hitungannya sudah sesuai keadaan tree saat ini

## Phase 1 plan boundary

Implementation plan pertama yang mengikuti roadmap ini harus mencakup **Phase 1 saja**, bukan seluruh roadmap.

Phase 1 plan harus fokus ke boundary dan file berikut:
- `src/tools/local.ts`
- `src/agent/react-agent.ts`
- `src/bot/bot.ts`
- `src/bot/conversations/job-detail.ts`
- `src/services/autonomous-jobs.ts`
- `src/memory/recall/service.ts`
- `src/memory/core/service.ts`
- `src/memory/backends/sqlite/backend.ts`
- test files yang mengunci behavior chat-mode tools, jobs ownership, memory summary visibility, dan task-canvas scoping
- `docs/bugs/2026-05-21-verified-bug-audit.md`

Phase 1 sengaja disatukan dalam satu plan karena keempat bug tersebut berbagi tema trust boundary yang sama dan kemungkinan menyentuh file yang saling overlap.

## Risks and tradeoffs

- Memisahkan roadmap dan implementation plan menambah satu langkah dokumentasi, tetapi hasilnya jauh lebih executable daripada satu giant plan untuk semua bug.
- Mengunci update ledger dalam setiap fix menambah sedikit overhead dokumentasi, tetapi mencegah status bug tertinggal dari code reality.
- Menggabungkan Workstream B dan C di phase 2 menjaga jumlah phase tetap kecil, tetapi implementation plan phase 2 nanti harus tetap dijaga agar tidak terlalu melebar.

## Success criteria

Roadmap ini dianggap berhasil bila:
- semua 13 bug terbuka punya home yang jelas dalam workstream dan phase
- phase 1 bisa dijalankan sebagai satu plan yang fokus dan testable
- semua phase mengikuti aturan update ledger yang sama
- setelah campaign selesai, `docs/bugs/2026-05-21-verified-bug-audit.md` menjadi ringkasan akurat dari bug yang sudah benar-benar fixed di tree
