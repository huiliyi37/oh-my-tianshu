/** Composer submission vocabulary shared by the input and settings domains. */

/** Delivery mode requested for one ordinary composer message. */
export type InputSubmitMode = 'queue' | 'steer'

/** Configurable meaning of plain Enter while the addressed agent is busy. */
export type BusyEnterBehavior = InputSubmitMode

/** Keyboard gesture whose delivery mode the submission policy resolves. */
export type ComposerSubmitGesture = 'enter' | 'accelerated'
