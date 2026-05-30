export type Deck = {
  color: string
  createdAt: string
  dailyGoal: number
  description: string
  examDate: string | null
  id: string
  tags: string[]
  title: string
  updatedAt: string
}

export type Card = {
  back: string
  createdAt: string
  deckId: string
  ease: number
  front: string
  hint: string
  id: string
  imageUrls: string[]
  interval: number
  lapses: number
  lastReviewedAt: string | null
  mastery: number
  mnemonic: string
  nextReviewAt: string | null
  reviewCount: number
  starred: boolean
  streak: number
  tags: string[]
  updatedAt: string
}

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy'
export type StudyMode = 'flip' | 'write'
export type StudyPreset = 'due' | 'mixed' | 'new' | 'starred' | 'weak'

export type AppState = {
  activeDeckId: string | null
  cards: Card[]
  decks: Deck[]
}

export type AuthUser = {
  createdAt: string
  email: string
  id: string
  name: string
}

