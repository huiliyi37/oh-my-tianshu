/** Shell chrome, General-nav, and welcome-notice dictionaries; feature rows own their copy. */
import { WELCOME_NOTICE_COPY } from '../onboarding-copy.ts'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
  'welcome.title': WELCOME_NOTICE_COPY.zh.title,
  'welcome.paragraph.0': WELCOME_NOTICE_COPY.zh.paragraphs[0],
  'welcome.paragraph.1': WELCOME_NOTICE_COPY.zh.paragraphs[1],
  'welcome.paragraph.2': WELCOME_NOTICE_COPY.zh.paragraphs[2],
  'welcome.feedbackEmphasis': WELCOME_NOTICE_COPY.zh.feedbackEmphasis,
  'welcome.continue': WELCOME_NOTICE_COPY.zh.continueLabel,
  'welcome.error': '暂时无法保存确认状态，请重试。',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
  'welcome.title': WELCOME_NOTICE_COPY.en.title,
  'welcome.paragraph.0': WELCOME_NOTICE_COPY.en.paragraphs[0],
  'welcome.paragraph.1': WELCOME_NOTICE_COPY.en.paragraphs[1],
  'welcome.paragraph.2': WELCOME_NOTICE_COPY.en.paragraphs[2],
  'welcome.feedbackEmphasis': WELCOME_NOTICE_COPY.en.feedbackEmphasis,
  'welcome.continue': WELCOME_NOTICE_COPY.en.continueLabel,
  'welcome.error': 'The acknowledgement could not be saved. Please try again.',
} satisfies Record<SettingsKey, string>
