import { type Conversation, type ConversationFlavor } from "@grammyjs/conversations";
import type { Context } from "grammy";

export type BotContext = ConversationFlavor<Context>;
export type ConversationContext = Context;
export type BotConversation = Conversation<BotContext, ConversationContext>;
