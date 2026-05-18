[memory-update:l1-start] {
  source: "telegram",
  userId: "5980836755",
  stage: "l1",
  status: "start",
  pendingTurns: 20,
}
Telegram bot error 236 |             // run middleware stack
237 |             await (0, composer_js_1.run)(this.middleware(), ctx);
238 |         }
239 |         catch (err) {
240 |             debugErr(`Error in middleware for update ${update.update_id}`);
241 |             throw new composer_js_1.BotError(err, ctx);
                                          ^
BotError: DataCloneError in middleware: The object can not be cloned.
 error: DOMException {
  line: 150,
  column: 88,
  sourceURL: "d:\\Code\\Test\\yunus\\grammy\\node_modules\\@grammyjs\\conversations\\out\\conversation.js",
  stack: "structuredClone@[native code]\nexternal@d:\\Code\\Test\\yunus\\grammy\\node_modules\\@grammyjs\\conversations\\out\\conversation.js:150:88\nasync memoryUpdateConversation@d:\\Code\\Test\\yunus\\grammy\\src\\bot\\conversations\\memory-update.ts:125:46\n@d:\\Code\\Test\\yunus\\grammy\\node_modules\\@grammyjs\\conversations\\out\\plugin.js:276:25\nasync run@d:\\Code\\Test\\yunus\\grammy\\node_modules\\@grammyjs\\conversations\\out\\engine.js:104:34\nasync replayState@d:\\Code\\Test\\yunus\\grammy\\node_modules\\@grammyjs\\conversations\\out\\engine.js:113:25\nasync replay@d:\\Code\\Test\\yunus\\grammy\\node_modules\\@grammyjs\\conversations\\out\\engine.js:13:31\nasync resumeConversation@d:\\Code\\Test\\yunus\\grammy\\node_modules\\@grammyjs\\conversations\\out\\plugin.js:285:45\nasync runParallelConversations@d:\\Code\\Test\\yunus\\grammy\\node_modules\\@grammyjs\\conversations\\out\\plugin.js:220:65\n@d:\\Code\\Test\\yunus\\grammy\\node_modules\\@grammyjs\\conversations\\out\\plugin.js:195:49\n@d:\\Code\\Test\\yunus\\grammy\\node_modules\\grammy\\out\\composer.js:146:22\n@d:\\Code\\Test\\yunus\\grammy\\node_modules\\@grammyjs\\conversations\\out\\plugin.js:146:19\nprocessTicksAndRejections@",
  code: 25,
  name: "DataCloneError",
  message: "The object can not be cloned.",
  INDEX_SIZE_ERR: 1,
  DOMSTRING_SIZE_ERR: 2,
  HIERARCHY_REQUEST_ERR: 3,
  WRONG_DOCUMENT_ERR: 4,
  INVALID_CHARACTER_ERR: 5,
  NO_DATA_ALLOWED_ERR: 6,
  NO_MODIFICATION_ALLOWED_ERR: 7,
  NOT_FOUND_ERR: 8,
  NOT_SUPPORTED_ERR: 9,
  INUSE_ATTRIBUTE_ERR: 10,
  INVALID_STATE_ERR: 11,
  SYNTAX_ERR: 12,
  INVALID_MODIFICATION_ERR: 13,
  NAMESPACE_ERR: 14,
  INVALID_ACCESS_ERR: 15,
  VALIDATION_ERR: 16,
  TYPE_MISMATCH_ERR: 17,
  SECURITY_ERR: 18,
  NETWORK_ERR: 19,
  ABORT_ERR: 20,
  URL_MISMATCH_ERR: 21,
  QUOTA_EXCEEDED_ERR: 22,
  TIMEOUT_ERR: 23,
  INVALID_NODE_TYPE_ERR: 24,
  DATA_CLONE_ERR: 25,
  toString: [Function: toString],
},
   ctx: Context {
  update: [Object ...],
  api: [Object ...],
  me: [Object ...],
  [Symbol(conversations.state)]: [Object ...],
  conversation: [Object ...],
  [Symbol(conversations.completeness)]: true,
  message: [Getter],
  editedMessage: [Getter],
  channelPost: [Getter],
  editedChannelPost: [Getter],
  businessConnection: [Getter],
  businessMessage: [Getter],
  editedBusinessMessage: [Getter],
  deletedBusinessMessages: [Getter],
  guestMessage: [Getter],
  messageReaction: [Getter],
  messageReactionCount: [Getter],
  inlineQuery: [Getter],
  chosenInlineResult: [Getter],
  callbackQuery: [Getter],
  shippingQuery: [Getter],
  preCheckoutQuery: [Getter],
  poll: [Getter],
  pollAnswer: [Getter],
  myChatMember: [Getter],
  chatMember: [Getter],
  managedBot: [Getter],
  chatJoinRequest: [Getter],
  chatBoost: [Getter],
  removedChatBoost: [Getter],
  purchasedPaidMedia: [Getter],
  msg: [Getter],
  chat: [Getter],
  senderChat: [Getter],
  from: [Getter],
  msgId: [Getter],
  chatId: [Getter],
  inlineMessageId: [Getter],
  businessConnectionId: [Getter],
  entities: [Function: entities],
  reactions: [Function: reactions],
  has: [Function: has],
  hasText: [Function: hasText],
  hasCommand: [Function: hasCommand],
  hasReaction: [Function: hasReaction],
  hasChatType: [Function: hasChatType],
  hasCallbackQuery: [Function: hasCallbackQuery],
  hasGameQuery: [Function: hasGameQuery],
  hasInlineQuery: [Function: hasInlineQuery],
  hasChosenInlineResult: [Function: hasChosenInlineResult],
  hasPreCheckoutQuery: [Function: hasPreCheckoutQuery],
  hasShippingQuery: [Function: hasShippingQuery],
  reply: [Function: reply],
  forwardMessage: [Function: forwardMessage],
  forwardMessages: [Function: forwardMessages],
  copyMessage: [Function: copyMessage],
  copyMessages: [Function: copyMessages],
  replyWithPhoto: [Function: replyWithPhoto],
  replyWithLivePhoto: [Function: replyWithLivePhoto],
  replyWithAudio: [Function: replyWithAudio],
  replyWithDocument: [Function: replyWithDocument],
  replyWithVideo: [Function: replyWithVideo],
  replyWithAnimation: [Function: replyWithAnimation],
  replyWithVoice: [Function: replyWithVoice],
  replyWithVideoNote: [Function: replyWithVideoNote],
  sendPaidMedia: [Function: sendPaidMedia],
  replyWithPaidMedia: [Function: replyWithPaidMedia],
  replyWithMediaGroup: [Function: replyWithMediaGroup],
  replyWithLocation: [Function: replyWithLocation],
  editMessageLiveLocation: [Function: editMessageLiveLocation],
  stopMessageLiveLocation: [Function: stopMessageLiveLocation],
  replyWithVenue: [Function: replyWithVenue],
  replyWithContact: [Function: replyWithContact],
  replyWithPoll: [Function: replyWithPoll],
  replyWithChecklist: [Function: replyWithChecklist],
  editMessageChecklist: [Function: editMessageChecklist],
  replyWithDice: [Function: replyWithDice],
  replyWithChatAction: [Function: replyWithChatAction],
  react: [Function: react],
  replyWithDraft: [Function: replyWithDraft],
  getUserProfilePhotos: [Function: getUserProfilePhotos],
  getUserProfileAudios: [Function: getUserProfileAudios],
  setUserEmojiStatus: [Function: setUserEmojiStatus],
  getUserChatBoosts: [Function: getUserChatBoosts],
  getUserGifts: [Function: getUserGifts],
  getChatGifts: [Function: getChatGifts],
  getBusinessConnection: [Function: getBusinessConnection],
  getManagedBotToken: [Function: getManagedBotToken],
  replaceManagedBotToken: [Function: replaceManagedBotToken],
  getManagedBotAccessSettings: [Function: getManagedBotAccessSettings],
  setManagedBotAccessSettings: [Function: setManagedBotAccessSettings],
  getFile: [Function: getFile],
  kickAuthor: [Function: kickAuthor],
  banAuthor: [Function: banAuthor],
  kickChatMember: [Function: kickChatMember],
  banChatMember: [Function: banChatMember],
  unbanChatMember: [Function: unbanChatMember],
  restrictAuthor: [Function: restrictAuthor],
  restrictChatMember: [Function: restrictChatMember],
  promoteAuthor: [Function: promoteAuthor],
  promoteChatMember: [Function: promoteChatMember],
  setChatAdministratorAuthorCustomTitle: [Function: setChatAdministratorAuthorCustomTitle],
  setChatAdministratorCustomTitle: [Function: setChatAdministratorCustomTitle],
  setAuthorTag: [Function: setAuthorTag],
  setChatMemberTag: [Function: setChatMemberTag],
  banChatSenderChat: [Function: banChatSenderChat],
  unbanChatSenderChat: [Function: unbanChatSenderChat],
  setChatPermissions: [Function: setChatPermissions],
  exportChatInviteLink: [Function: exportChatInviteLink],
  createChatInviteLink: [Function: createChatInviteLink],
  editChatInviteLink: [Function: editChatInviteLink],
  createChatSubscriptionInviteLink: [Function: createChatSubscriptionInviteLink],
  editChatSubscriptionInviteLink: [Function: editChatSubscriptionInviteLink],
  revokeChatInviteLink: [Function: revokeChatInviteLink],
  approveChatJoinRequest: [Function: approveChatJoinRequest],
  declineChatJoinRequest: [Function: declineChatJoinRequest],
  approveSuggestedPost: [Function: approveSuggestedPost],
  declineSuggestedPost: [Function: declineSuggestedPost],
  setChatPhoto: [Function: setChatPhoto],
  deleteChatPhoto: [Function: deleteChatPhoto],
  setChatTitle: [Function: setChatTitle],
  setChatDescription: [Function: setChatDescription],
  pinChatMessage: [Function: pinChatMessage],
  unpinChatMessage: [Function: unpinChatMessage],
  unpinAllChatMessages: [Function: unpinAllChatMessages],
  leaveChat: [Function: leaveChat],
  getChat: [Function: getChat],
  getChatAdministrators: [Function: getChatAdministrators],
  getChatMembersCount: [Function: getChatMembersCount],
  getChatMemberCount: [Function: getChatMemberCount],
  getAuthor: [Function: getAuthor],
  getChatMember: [Function: getChatMember],
  getUserPersonalChatMessages: [Function: getUserPersonalChatMessages],
  setChatStickerSet: [Function: setChatStickerSet],
  deleteChatStickerSet: [Function: deleteChatStickerSet],
  createForumTopic: [Function: createForumTopic],
  editForumTopic: [Function: editForumTopic],
  closeForumTopic: [Function: closeForumTopic],
  reopenForumTopic: [Function: reopenForumTopic],
  deleteForumTopic: [Function: deleteForumTopic],
  unpinAllForumTopicMessages: [Function: unpinAllForumTopicMessages],
  editGeneralForumTopic: [Function: editGeneralForumTopic],
  closeGeneralForumTopic: [Function: closeGeneralForumTopic],
  reopenGeneralForumTopic: [Function: reopenGeneralForumTopic],
  hideGeneralForumTopic: [Function: hideGeneralForumTopic],
  unhideGeneralForumTopic: [Function: unhideGeneralForumTopic],
  unpinAllGeneralForumTopicMessages: [Function: unpinAllGeneralForumTopicMessages],
  answerCallbackQuery: [Function: answerCallbackQuery],
  answerGuestQuery: [Function: answerGuestQuery],
  setChatMenuButton: [Function: setChatMenuButton],
  getChatMenuButton: [Function: getChatMenuButton],
  setMyDefaultAdministratorRights: [Function: setMyDefaultAdministratorRights],
  getMyDefaultAdministratorRights: [Function: getMyDefaultAdministratorRights],
  editMessageText: [Function: editMessageText],
  editMessageCaption: [Function: editMessageCaption],
  editMessageMedia: [Function: editMessageMedia],
  editMessageReplyMarkup: [Function: editMessageReplyMarkup],
  stopPoll: [Function: stopPoll],
  deleteMessage: [Function: deleteMessage],
  deleteMessages: [Function: deleteMessages],
  deleteMessageReaction: [Function: deleteMessageReaction],
  deleteMessageReactionUser: [Function: deleteMessageReactionUser],
  deleteMessageReactionChat: [Function: deleteMessageReactionChat],
  deleteAllMessageReactions: [Function: deleteAllMessageReactions],
  deleteAllMessageReactionsUser: [Function: deleteAllMessageReactionsUser],
  deleteAllMessageReactionsChat: [Function: deleteAllMessageReactionsChat],
  deleteBusinessMessages: [Function: deleteBusinessMessages],
  setBusinessAccountName: [Function: setBusinessAccountName],
  setBusinessAccountUsername: [Function: setBusinessAccountUsername],
  setBusinessAccountBio: [Function: setBusinessAccountBio],
  setBusinessAccountProfilePhoto: [Function: setBusinessAccountProfilePhoto],
  removeBusinessAccountProfilePhoto: [Function: removeBusinessAccountProfilePhoto],
  setBusinessAccountGiftSettings: [Function: setBusinessAccountGiftSettings],
  getBusinessAccountStarBalance: [Function: getBusinessAccountStarBalance],
  transferBusinessAccountStars: [Function: transferBusinessAccountStars],
  getBusinessAccountGifts: [Function: getBusinessAccountGifts],
  convertGiftToStars: [Function: convertGiftToStars],
  upgradeGift: [Function: upgradeGift],
  transferGift: [Function: transferGift],
  postStory: [Function: postStory],
  repostStory: [Function: repostStory],
  editStory: [Function: editStory],
  deleteStory: [Function: deleteStory],
  replyWithSticker: [Function: replyWithSticker],
  getCustomEmojiStickers: [Function: getCustomEmojiStickers],
  replyWithGift: [Function: replyWithGift],
  giftPremiumSubscription: [Function: giftPremiumSubscription],
  replyWithGiftToChannel: [Function: replyWithGiftToChannel],
  answerInlineQuery: [Function: answerInlineQuery],
  savePreparedInlineMessage: [Function: savePreparedInlineMessage],
  savePreparedKeyboardButton: [Function: savePreparedKeyboardButton],
  replyWithInvoice: [Function: replyWithInvoice],
  answerShippingQuery: [Function: answerShippingQuery],
  answerPreCheckoutQuery: [Function: answerPreCheckoutQuery],
  refundStarPayment: [Function: refundStarPayment],
  editUserStarSubscription: [Function: editUserStarSubscription],
  verifyUser: [Function: verifyUser],
  verifyChat: [Function: verifyChat],
  removeUserVerification: [Function: removeUserVerification],
  removeChatVerification: [Function: removeChatVerification],
  readBusinessMessage: [Function: readBusinessMessage],
  setPassportDataErrors: [Function: setPassportDataErrors],
  replyWithGame: [Function: replyWithGame],
},

      at D:\Code\Test\yunus\grammy\node_modules\grammy\out\bot.js:241:37

[memory-update:l1-complete] {
  source: "telegram",
  userId: "5980836755",
  stage: "l1",
  status: "complete",
  pendingTurns: 20,
  createdAtoms: 1,
  checkpointAdvanced: true,
}
Telegram memory update message send failed {
  userId: "5980836755",
  error: 139 |     let promises = 0; // counts the number of promises on the event loop
140 |     let dirty = (0, resolve_js_1.resolver)(); // resolves as soon as the event loop is clear
141 |     let complete = false; // locks the engine after the event loop has cleared
142 |     function begin() {
143 |         if (complete) {
144 |             throw new Error("Cannot begin another operation after the replay has completed, are you missing an `await`?");
                            ^
error: Cannot begin another operation after the replay has completed, are you missing an `await`?
      at begin (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\engine.js:144:23)
      at action (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\engine.js:191:9)
      at <anonymous> (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\plugin.js:584:40)
      at <anonymous> (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\menu.js:164:26)
      at async <anonymous> (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\menu.js:178:26)
      at async callApi (D:\Code\Test\yunus\grammy\node_modules\grammy\out\core\client.js:96:33)
      at async safeSendMemoryUpdateMessage (D:\Code\Test\yunus\grammy\src\bot\conversations\memory-update-runner.ts:26:17)
      at async <anonymous> (D:\Code\Test\yunus\grammy\src\bot\conversations\memory-update-runner.ts:95:30)
      at async emitMemoryUpdateProgress (D:\Code\Test\yunus\grammy\src\memory\pipeline\progress.ts:40:11)
      at async reportMemoryUpdateProgress (D:\Code\Test\yunus\grammy\src\cron\autonomous.ts:80:11)
      at async emitMemoryUpdateProgress (D:\Code\Test\yunus\grammy\src\memory\pipeline\progress.ts:40:11)
      at async runMaintenanceForUser (D:\Code\Test\yunus\grammy\src\memory\pipeline\coordinator.ts:46:11)
,
}
[memory-update:l2-start] {
  source: "telegram",
  userId: "5980836755",
  stage: "l2",
  status: "start",
  atomCount: 9,
}
Telegram memory update message send failed {
  userId: "5980836755",
  error: 139 |     let promises = 0; // counts the number of promises on the event loop
140 |     let dirty = (0, resolve_js_1.resolver)(); // resolves as soon as the event loop is clear
141 |     let complete = false; // locks the engine after the event loop has cleared
142 |     function begin() {
143 |         if (complete) {
144 |             throw new Error("Cannot begin another operation after the replay has completed, are you missing an `await`?");
                            ^
error: Cannot begin another operation after the replay has completed, are you missing an `await`?
      at begin (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\engine.js:144:23)
      at action (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\engine.js:191:9)
      at <anonymous> (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\plugin.js:584:40)
      at <anonymous> (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\menu.js:164:26)
      at async <anonymous> (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\menu.js:178:26)
      at async callApi (D:\Code\Test\yunus\grammy\node_modules\grammy\out\core\client.js:96:33)
      at async safeSendMemoryUpdateMessage (D:\Code\Test\yunus\grammy\src\bot\conversations\memory-update-runner.ts:26:17)
      at async <anonymous> (D:\Code\Test\yunus\grammy\src\bot\conversations\memory-update-runner.ts:95:30)
      at async emitMemoryUpdateProgress (D:\Code\Test\yunus\grammy\src\memory\pipeline\progress.ts:40:11)
      at async reportMemoryUpdateProgress (D:\Code\Test\yunus\grammy\src\cron\autonomous.ts:80:11)
      at async emitMemoryUpdateProgress (D:\Code\Test\yunus\grammy\src\memory\pipeline\progress.ts:40:11)
      at async runMaintenanceForUser (D:\Code\Test\yunus\grammy\src\memory\pipeline\coordinator.ts:69:11)
,
}
[memory-update:l2-complete] {
  source: "telegram",
  userId: "5980836755",
  stage: "l2",
  status: "complete",
  atomCount: 9,
  scenarioId: 11,
}
Telegram memory update message send failed {
  userId: "5980836755",
  error: 139 |     let promises = 0; // counts the number of promises on the event loop
140 |     let dirty = (0, resolve_js_1.resolver)(); // resolves as soon as the event loop is clear
141 |     let complete = false; // locks the engine after the event loop has cleared
142 |     function begin() {
143 |         if (complete) {
144 |             throw new Error("Cannot begin another operation after the replay has completed, are you missing an `await`?");
                            ^
error: Cannot begin another operation after the replay has completed, are you missing an `await`?
      at begin (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\engine.js:144:23)
      at action (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\engine.js:191:9)
      at <anonymous> (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\plugin.js:584:40)
      at <anonymous> (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\menu.js:164:26)
      at async <anonymous> (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\menu.js:178:26)
      at async callApi (D:\Code\Test\yunus\grammy\node_modules\grammy\out\core\client.js:96:33)
      at async safeSendMemoryUpdateMessage (D:\Code\Test\yunus\grammy\src\bot\conversations\memory-update-runner.ts:26:17)
      at async <anonymous> (D:\Code\Test\yunus\grammy\src\bot\conversations\memory-update-runner.ts:95:30)
      at async emitMemoryUpdateProgress (D:\Code\Test\yunus\grammy\src\memory\pipeline\progress.ts:40:11)
      at async reportMemoryUpdateProgress (D:\Code\Test\yunus\grammy\src\cron\autonomous.ts:80:11)
      at async emitMemoryUpdateProgress (D:\Code\Test\yunus\grammy\src\memory\pipeline\progress.ts:40:11)
      at async runMaintenanceForUser (D:\Code\Test\yunus\grammy\src\memory\pipeline\coordinator.ts:76:11)
,
}
[memory-update:l3-start] {
  source: "telegram",
  userId: "5980836755",
  stage: "l3",
  status: "start",
  scenarioId: 11,
}
Telegram memory update message send failed {
  userId: "5980836755",
  error: 139 |     let promises = 0; // counts the number of promises on the event loop
140 |     let dirty = (0, resolve_js_1.resolver)(); // resolves as soon as the event loop is clear
141 |     let complete = false; // locks the engine after the event loop has cleared
142 |     function begin() {
143 |         if (complete) {
144 |             throw new Error("Cannot begin another operation after the replay has completed, are you missing an `await`?");
                            ^
error: Cannot begin another operation after the replay has completed, are you missing an `await`?
      at begin (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\engine.js:144:23)
      at action (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\engine.js:191:9)
      at <anonymous> (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\plugin.js:584:40)
      at <anonymous> (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\menu.js:164:26)
      at async <anonymous> (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\menu.js:178:26)
      at async callApi (D:\Code\Test\yunus\grammy\node_modules\grammy\out\core\client.js:96:33)
      at async safeSendMemoryUpdateMessage (D:\Code\Test\yunus\grammy\src\bot\conversations\memory-update-runner.ts:26:17)
      at async <anonymous> (D:\Code\Test\yunus\grammy\src\bot\conversations\memory-update-runner.ts:95:30)
      at async emitMemoryUpdateProgress (D:\Code\Test\yunus\grammy\src\memory\pipeline\progress.ts:40:11)
      at async reportMemoryUpdateProgress (D:\Code\Test\yunus\grammy\src\cron\autonomous.ts:80:11)
      at async emitMemoryUpdateProgress (D:\Code\Test\yunus\grammy\src\memory\pipeline\progress.ts:40:11)
      at async runMaintenanceForUser (D:\Code\Test\yunus\grammy\src\memory\pipeline\coordinator.ts:78:11)
,
}
[memory-update:l3-complete] {
  source: "telegram",
  userId: "5980836755",
  stage: "l3",
  status: "complete",
  scenarioId: 11,
  personaUpdated: true,
}
Telegram memory update message send failed {
  userId: "5980836755",
  error: 139 |     let promises = 0; // counts the number of promises on the event loop
140 |     let dirty = (0, resolve_js_1.resolver)(); // resolves as soon as the event loop is clear
141 |     let complete = false; // locks the engine after the event loop has cleared
142 |     function begin() {
143 |         if (complete) {
144 |             throw new Error("Cannot begin another operation after the replay has completed, are you missing an `await`?");
                            ^
error: Cannot begin another operation after the replay has completed, are you missing an `await`?
      at begin (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\engine.js:144:23)
      at action (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\engine.js:191:9)
      at <anonymous> (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\plugin.js:584:40)
      at <anonymous> (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\menu.js:164:26)
      at async <anonymous> (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\menu.js:178:26)
      at async callApi (D:\Code\Test\yunus\grammy\node_modules\grammy\out\core\client.js:96:33)
      at async safeSendMemoryUpdateMessage (D:\Code\Test\yunus\grammy\src\bot\conversations\memory-update-runner.ts:26:17)
      at async <anonymous> (D:\Code\Test\yunus\grammy\src\bot\conversations\memory-update-runner.ts:95:30)
      at async emitMemoryUpdateProgress (D:\Code\Test\yunus\grammy\src\memory\pipeline\progress.ts:40:11)
      at async reportMemoryUpdateProgress (D:\Code\Test\yunus\grammy\src\cron\autonomous.ts:80:11)
      at async emitMemoryUpdateProgress (D:\Code\Test\yunus\grammy\src\memory\pipeline\progress.ts:40:11)
      at async runMaintenanceForUser (D:\Code\Test\yunus\grammy\src\memory\pipeline\coordinator.ts:86:11)
,
}
[memory-update:run-complete] {
  source: "telegram",
  userId: "5980836755",
  stage: "run",
  status: "complete",
  startedAtUnix: 1779063980,
  finishedAtUnix: 1779063991,
  durationMs: 10934,
  createdAtoms: 1,
  scenarioId: 11,
  personaUpdated: true,
}
Telegram memory update message send failed {
  userId: "5980836755",
  error: 139 |     let promises = 0; // counts the number of promises on the event loop
140 |     let dirty = (0, resolve_js_1.resolver)(); // resolves as soon as the event loop is clear
141 |     let complete = false; // locks the engine after the event loop has cleared
142 |     function begin() {
143 |         if (complete) {
144 |             throw new Error("Cannot begin another operation after the replay has completed, are you missing an `await`?");
                            ^
error: Cannot begin another operation after the replay has completed, are you missing an `await`?
      at begin (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\engine.js:144:23)
      at action (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\engine.js:191:9)
      at <anonymous> (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\plugin.js:584:40)
      at <anonymous> (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\menu.js:164:26)
      at async <anonymous> (D:\Code\Test\yunus\grammy\node_modules\@grammyjs\conversations\out\menu.js:178:26)
      at async callApi (D:\Code\Test\yunus\grammy\node_modules\grammy\out\core\client.js:96:33)
      at async safeSendMemoryUpdateMessage (D:\Code\Test\yunus\grammy\src\bot\conversations\memory-update-runner.ts:26:17)
      at async <anonymous> (D:\Code\Test\yunus\grammy\src\bot\conversations\memory-update-runner.ts:98:13)
,
}
^C
D:\Code\Test\yunus\grammy>
