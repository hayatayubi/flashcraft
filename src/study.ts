import type { Card, ReviewRating, StudyPreset } from './types'

const hourMs = 60 * 60 * 1000
const dayMs = 24 * hourMs

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

export function parseTagInput(raw: string) {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

export function isDue(card: Card, now = new Date()) {
  if (!card.nextReviewAt) return true
  return new Date(card.nextReviewAt).getTime() <= now.getTime()
}

export function formatCalendarDate(value: string | null) {
  if (!value) return 'No exam date'
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

export function formatRelativeReview(value: string | null) {
  if (!value) return 'New card'

  const diff = new Date(value).getTime() - Date.now()
  if (diff <= 0) return 'Due now'

  if (diff < dayMs) {
    return `In ${Math.ceil(diff / hourMs)}h`
  }

  return `In ${Math.ceil(diff / dayMs)}d`
}

export function daysUntil(value: string | null) {
  if (!value) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const target = new Date(value)
  target.setHours(0, 0, 0, 0)

  return Math.round((target.getTime() - today.getTime()) / dayMs)
}

export function buildStudyQueue(cards: Card[], deckId: string | null, preset: StudyPreset) {
  const inScope = cards.filter((card) => !deckId || card.deckId === deckId)

  const sorted = [...inScope].sort((left, right) => {
    const leftScore = Number(isDue(left)) * 80 + Number(left.starred) * 20 - left.mastery - left.streak * 2
    const rightScore = Number(isDue(right)) * 80 + Number(right.starred) * 20 - right.mastery - right.streak * 2
    return rightScore - leftScore
  })

  if (preset === 'due') {
    return sorted.filter((card) => isDue(card)).map((card) => card.id)
  }

  if (preset === 'new') {
    return sorted.filter((card) => card.reviewCount === 0).map((card) => card.id)
  }

  if (preset === 'weak') {
    return [...inScope]
      .sort((left, right) => left.mastery - right.mastery || right.lapses - left.lapses)
      .slice(0, 25)
      .map((card) => card.id)
  }

  if (preset === 'starred') {
    return sorted.filter((card) => card.starred).map((card) => card.id)
  }

  return sorted.slice(0, 30).map((card) => card.id)
}

export function applyReviewResult(card: Card, rating: ReviewRating, now = new Date()): Card {
  let ease = card.ease || 2.3
  let interval = card.interval || 0
  let nextReview = new Date(now)
  let mastery = card.mastery
  let streak = card.streak
  let lapses = card.lapses

  if (rating === 'again') {
    ease = clamp(ease - 0.2, 1.3, 3.2)
    interval = 0
    nextReview = new Date(now.getTime() + 20 * 60 * 1000)
    mastery = clamp(mastery - 14, 0, 100)
    streak = 0
    lapses += 1
  }

  if (rating === 'hard') {
    ease = clamp(ease - 0.1, 1.3, 3.2)
    interval = card.reviewCount === 0 ? 1 : Math.max(1, Math.round((card.interval || 1) * 1.2))
    nextReview = new Date(now.getTime() + interval * dayMs)
    mastery = clamp(mastery + 5, 0, 100)
    streak += 1
  }

  if (rating === 'good') {
    ease = clamp(ease + 0.05, 1.3, 3.2)
    interval = card.reviewCount === 0 ? 2 : Math.max(2, Math.round((card.interval || 1) * ease))
    nextReview = new Date(now.getTime() + interval * dayMs)
    mastery = clamp(mastery + 12, 0, 100)
    streak += 1
  }

  if (rating === 'easy') {
    ease = clamp(ease + 0.12, 1.3, 3.3)
    interval =
      card.reviewCount === 0
        ? 4
        : Math.max(3, Math.round((card.interval || 1) * (ease + 0.5)))
    nextReview = new Date(now.getTime() + interval * dayMs)
    mastery = clamp(mastery + 18, 0, 100)
    streak += 1
  }

  return {
    ...card,
    ease,
    interval,
    lapses,
    lastReviewedAt: now.toISOString(),
    mastery,
    nextReviewAt: nextReview.toISOString(),
    reviewCount: card.reviewCount + 1,
    streak,
    updatedAt: now.toISOString(),
  }
}
