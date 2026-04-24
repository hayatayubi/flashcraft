import type { AppState } from './types'

export function createSeedState(): AppState {
  return {
    activeDeckId: null,
    cards: [],
    decks: [],
  }
}
