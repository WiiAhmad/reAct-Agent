import type { BotConversation } from "../context";

export async function waitForCallbackData(conversation: BotConversation, isExpectedData: (data: string | undefined) => boolean) {
  const action = await conversation.waitFor("callback_query:data", { next: true });
  if (!isExpectedData(action.callbackQuery.data)) {
    await conversation.skip({ next: true });
  }
  return action;
}

export async function waitForTextInput(conversation: BotConversation) {
  const messageCtx = await conversation.waitFor("message:text", { next: true });
  if (messageCtx.message.text.startsWith("/")) {
    await conversation.skip({ next: true });
  }
  return messageCtx;
}
