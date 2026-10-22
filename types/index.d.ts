// Whether this session holds the screen, which the prompt footer reads.
export type IsHolding = boolean

declare module 'claude-code' {
  interface PluginState {
    'cc-mod-caffeinate': { isHolding: IsHolding }
  }
}
