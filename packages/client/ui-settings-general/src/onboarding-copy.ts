/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-08-13.1'

/** The complete editable welcome notice in both supported GUI locales. */
export const WELCOME_NOTICE_COPY = {
  zh: {
    title: '欢迎使用天枢',
    paragraphs: [
      '感谢您试用天枢 Harness（Tianshu）。这是一个 MIT 许可的开源 coding agent，自 DeepSeek Harness 分叉后独立演进。',
      '“如切如磋，如琢如磨。” 产品的成长，离不开一次次真实的碰撞与坦诚的反馈。您在真实使用中发现的问题，也可能促使我们重新审视，甚至推翻已有的设计。',
      '遥测默认关闭：不会向任何地方上传任何会话数据；只有当您显式设置 DSH_TELEMETRY_OTLP_URL 指向自己的收集器时才会启用。如果您有任何反馈与建议，欢迎在 GitHub 仓库提 issue。每一条反馈，都会帮助我们把它打磨得更好。',
    ],
    feedbackEmphasis: '如果您有任何反馈与建议，欢迎在 GitHub 仓库提 issue',
    continueLabel: '继续',
  },
  en: {
    title: 'Welcome to Tianshu',
    paragraphs: [
      'Thank you for trying Tianshu Harness — an MIT-licensed open-source coding agent, evolving independently since its fork from DeepSeek Harness.',
      'A product grows through honest collisions with real use. Problems you hit may well make us rethink, or even overturn, existing designs.',
      'Telemetry is disabled by default: no session data is uploaded anywhere unless you explicitly point DSH_TELEMETRY_OTLP_URL at your own collector. If you have feedback or suggestions, please open an issue on the GitHub repository — every report helps us polish it further.',
    ],
    feedbackEmphasis: 'If you have feedback or suggestions, please open an issue on the GitHub repository',
    continueLabel: 'Continue',
  },
} as const
