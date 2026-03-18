// Channel names scoped per room code to prevent cross-room event bleed.
// All components and API routes must use these helpers — never hardcode channel strings.

export const channels = {
  roomStatus: (code: string) => `room:${code}:status`,
  roomPlayers: (code: string) => `room:${code}:players`,
  roomPrompts: (code: string) => `room:${code}:prompts`,
  roundTimer: (code: string) => `room:${code}:round:timer`,
  roundPass: (code: string) => `room:${code}:round:pass`,
  revealAdvance: (code: string) => `room:${code}:reveal:advance`,
} as const;
