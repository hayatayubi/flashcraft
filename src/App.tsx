import { startTransition, useEffect, useEffectEvent, useRef, useState } from 'react'
import './App.css'
import {
  fetchHealth,
  fetchRemoteState,
  getSession,
  login,
  register,
  saveRemoteState,
} from './api'
import { createSeedState } from './seed'
import { applyReviewResult, buildStudyQueue, formatRelativeReview, isDue } from './study'
import type { AppState, AuthUser, Card, Deck, ReviewRating } from './types'

const STORAGE_KEY = 'flashcraft-local-state-v3'
const THEME_STORAGE_KEY = 'flashcraft-theme'

function normalizeAnswer(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
}

function isAnswerCorrect(typed: string, correct: string): boolean {
  const a = normalizeAnswer(typed)
  const b = normalizeAnswer(correct)
  if (!a || !b) return false
  return a === b
}

type ThemeId = 'pink' | 'blue' | 'green' | 'red' | 'white'

type ThemeOption = {
  id: ThemeId
  name: string
  blurb: string
  swatch: [string, string, string]
}

const THEMES: ThemeOption[] = [
  { id: 'pink', name: 'Blossom', blurb: 'The original, warm pink', swatch: ['#fff5fb', '#ffb6dd', '#d94c97'] },
  { id: 'blue', name: 'Tide', blurb: 'Cool blue, calm focus', swatch: ['#eef5ff', '#93c5fd', '#3b82f6'] },
  { id: 'green', name: 'Sprout', blurb: 'Fresh green, easy on the eyes', swatch: ['#effaf3', '#86efac', '#10b981'] },
  { id: 'red', name: 'Ember', blurb: 'Bold red, high energy', swatch: ['#fff4f4', '#fca5a5', '#ef4444'] },
  { id: 'white', name: 'Paper', blurb: 'Minimal grayscale', swatch: ['#fbfbfc', '#e5e7eb', '#4b5563'] },
]

function loadTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored && THEMES.some((t) => t.id === stored)) return stored as ThemeId
  } catch {}
  return 'pink'
}

type Screen = 'deck' | 'decks' | 'settings' | 'study'
type AuthMode = 'login' | 'register'
type SyncStatus = 'error' | 'idle' | 'saved' | 'saving'

type DeckDraft = {
  description: string
  title: string
}

type CardDraft = {
  back: string
  front: string
  imageUrls: string[]
}

type AuthDraft = {
  email: string
  name: string
  password: string
}

type SessionStats = {
  easy: number
  good: number
  hard: number
  reviewed: number
}

type ToastState = {
  actionLabel?: string
  id: number
  message: string
  onAction?: () => void
  tone: 'error' | 'info' | 'success'
  duration?: number
}

function emptyDeckDraft(): DeckDraft {
  return {
    description: '',
    title: '',
  }
}

function emptyCardDraft(): CardDraft {
  return {
    back: '',
    front: '',
    imageUrls: [],
  }
}

function emptySessionStats(): SessionStats {
  return {
    easy: 0,
    good: 0,
    hard: 0,
    reviewed: 0,
  }
}

function normalizeCard(card: Partial<Card> & { id: string; deckId: string; front: string; back: string }): Card {
  const legacyImageUrl = 'imageUrl' in card && typeof card.imageUrl === 'string' ? card.imageUrl : null
  const imageUrls = Array.isArray(card.imageUrls)
    ? card.imageUrls.filter((value): value is string => typeof value === 'string' && Boolean(value))
    : legacyImageUrl
      ? [legacyImageUrl]
      : []

  return {
    back: card.back,
    createdAt: card.createdAt ?? new Date().toISOString(),
    deckId: card.deckId,
    ease: card.ease ?? 2.3,
    front: card.front,
    hint: card.hint ?? '',
    id: card.id,
    imageUrls,
    interval: card.interval ?? 0,
    lapses: card.lapses ?? 0,
    lastReviewedAt: card.lastReviewedAt ?? null,
    mastery: card.mastery ?? 20,
    mnemonic: card.mnemonic ?? '',
    nextReviewAt: card.nextReviewAt ?? null,
    reviewCount: card.reviewCount ?? 0,
    starred: card.starred ?? false,
    streak: card.streak ?? 0,
    tags: Array.isArray(card.tags) ? card.tags : [],
    updatedAt: card.updatedAt ?? new Date().toISOString(),
  }
}

function loadLocalState(): AppState {
  if (typeof window === 'undefined') {
    return createSeedState()
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return createSeedState()

    const parsed = JSON.parse(raw) as Partial<AppState>
    if (!Array.isArray(parsed.decks) || !Array.isArray(parsed.cards)) {
      return createSeedState()
    }

    return {
      activeDeckId:
        typeof parsed.activeDeckId === 'string' || parsed.activeDeckId === null
          ? parsed.activeDeckId
          : parsed.decks[0]?.id ?? null,
      cards: (parsed.cards as Array<Partial<Card> & { id: string; deckId: string; front: string; back: string }>).map(
        normalizeCard,
      ),
      decks: parsed.decks as Deck[],
    }
  } catch {
    return createSeedState()
  }
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Could not read the selected image.'))
      }
    }
    reader.onerror = () => reject(new Error('Could not read the selected image.'))
    reader.readAsDataURL(file)
  })
}

function readFilesAsDataUrls(files: File[]) {
  return Promise.all(files.map((file) => readFileAsDataUrl(file)))
}

function App() {
  const initialState = loadLocalState()
  const cardImageRef = useRef<HTMLInputElement | null>(null)
  const hasHydratedAccountRef = useRef(false)
  const toastIdRef = useRef(0)

  const [decks, setDecks] = useState<Deck[]>(initialState.decks)
  const [cards, setCards] = useState<Card[]>(initialState.cards)
  const [activeDeckId, setActiveDeckId] = useState<string | null>(initialState.activeDeckId)
  const [screen, setScreen] = useState<Screen>('decks')

  const [authResolved, setAuthResolved] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null)
  const [authMode, setAuthMode] = useState<AuthMode>('register')
  const [authDraft, setAuthDraft] = useState<AuthDraft>({ email: '', name: '', password: '' })
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')
  const [theme, setTheme] = useState<ThemeId>(() => loadTheme())

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {}
  }, [theme])

  const [deckDraft, setDeckDraft] = useState<DeckDraft>(emptyDeckDraft())
  const [deckEditorId, setDeckEditorId] = useState<string | null>(null)
  const [deckComposerOpen, setDeckComposerOpen] = useState(false)

  const [cardDraft, setCardDraft] = useState<CardDraft>(emptyCardDraft())
  const [cardEditorId, setCardEditorId] = useState<string | null>(null)
  const [cardComposerOpen, setCardComposerOpen] = useState(false)
  const [cardSearch, setCardSearch] = useState('')
  const [previewCardId, setPreviewCardId] = useState<string | null>(null)
  const [previewRevealed, setPreviewRevealed] = useState(false)

  const [studyQueue, setStudyQueue] = useState<string[]>([])
  const [studyIndex, setStudyIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [sessionStats, setSessionStats] = useState<SessionStats>(emptySessionStats())
  const [typedAnswer, setTypedAnswer] = useState('')
  const [answerCorrect, setAnswerCorrect] = useState<boolean | null>(null)

  const [toast, setToast] = useState<ToastState | null>(null)

  const activeDeck =
    activeDeckId === null ? null : decks.find((deck) => deck.id === activeDeckId) ?? decks[0] ?? null
  const deckCards = activeDeck ? cards.filter((card) => card.deckId === activeDeck.id) : []
  const filteredDeckCards = (() => {
    const query = cardSearch.trim().toLowerCase()
    const sorted = [...deckCards].sort((left, right) => {
      if (isDue(left) !== isDue(right)) return Number(isDue(right)) - Number(isDue(left))
      return left.front.localeCompare(right.front)
    })

    if (!query) return sorted

    return sorted.filter((card) => [card.front, card.back].join(' ').toLowerCase().includes(query))
  })()

  const currentCardId = studyQueue[studyIndex]
  const currentCard = currentCardId ? cards.find((card) => card.id === currentCardId) ?? null : null
  const previewCard = previewCardId ? cards.find((card) => card.id === previewCardId) ?? null : null
  const sessionComplete = studyQueue.length > 0 && !currentCard
  const studyProgress = studyQueue.length ? Math.min(100, Math.round((studyIndex / studyQueue.length) * 100)) : 0

  function pushToast(
    message: string,
    tone: ToastState['tone'] = 'success',
    options?: Pick<ToastState, 'actionLabel' | 'duration' | 'onAction'>,
  ) {
    toastIdRef.current += 1
    setToast({
      actionLabel: options?.actionLabel,
      duration: options?.duration,
      id: toastIdRef.current,
      message,
      onAction: options?.onAction,
      tone,
    })
  }

  function applyAppState(state: AppState) {
    setDecks(state.decks)
    setCards(state.cards.map((card) => normalizeCard(card)))
    setActiveDeckId(state.activeDeckId)
    setDeckComposerOpen(false)
  }

  async function hydrateSignedInUser(user: AuthUser) {
    setSessionUser(user)
    setSessionReady(false)
    setAuthError('')

    const localState = loadLocalState()
    const remote = await fetchRemoteState()
    const nextState = remote.state ?? localState
    applyAppState(nextState)

    if (!remote.state) {
      await saveRemoteState(nextState)
    }

    hasHydratedAccountRef.current = true
    setSyncStatus('saved')
    setSessionReady(true)
  }

  const bootstrapSession = useEffectEvent(async () => {
    try {
      await fetchHealth()
      const session = await getSession()
      if (session.user) {
        await hydrateSignedInUser(session.user)
      }
    } catch {
      setAuthError('Could not reach the local account server. Start the dev server and try again.')
    } finally {
      setAuthResolved(true)
    }
  })

  useEffect(() => {
    queueMicrotask(() => {
      void bootstrapSession()
    })
  }, [])

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeDeckId: activeDeck?.id ?? null,
        cards,
        decks,
      } satisfies AppState),
    )
  }, [activeDeck, cards, decks])

  useEffect(() => {
    if (!sessionUser || !sessionReady || !hasHydratedAccountRef.current) return

    setSyncStatus('saving')
    const timeout = window.setTimeout(async () => {
      try {
        await saveRemoteState({
          activeDeckId: activeDeck?.id ?? null,
          cards,
          decks,
        })
        setSyncStatus('saved')
      } catch {
        setSyncStatus('error')
      }
    }, 600)

    return () => window.clearTimeout(timeout)
  }, [activeDeck, cards, decks, sessionReady, sessionUser])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), toast.duration ?? 2400)
    return () => window.clearTimeout(timeout)
  }, [toast])

  useEffect(() => {
    const titleBase = 'Flashcraft'
    const nextTitle =
      screen === 'study' && activeDeck
        ? `${activeDeck.title} • Study • ${titleBase}`
        : screen === 'deck' && activeDeck
          ? `${activeDeck.title} • ${titleBase}`
          : `My Decks • ${titleBase}`
    document.title = nextTitle
  }, [activeDeck, screen])

  function resetDeckComposer() {
    setDeckEditorId(null)
    setDeckDraft(emptyDeckDraft())
  }

  function openDeck(deckId: string) {
    setActiveDeckId(deckId)
    setScreen('deck')
    setCardComposerOpen(false)
    setCardEditorId(null)
  }

  function openNewDeckComposer() {
    resetDeckComposer()
    setDeckComposerOpen(true)
  }

  function openDeckEditor(deck: Deck) {
    setDeckEditorId(deck.id)
    setDeckDraft({
      description: deck.description,
      title: deck.title,
    })
    setDeckComposerOpen(true)
    setScreen('deck')
    setActiveDeckId(deck.id)
  }

  async function handleAuthSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAuthBusy(true)
    setAuthError('')

    try {
      const result =
        authMode === 'register'
          ? await register(authDraft)
          : await login({ email: authDraft.email, password: authDraft.password })
      await hydrateSignedInUser(result.user)
      setScreen('decks')
      setAuthDraft({ email: authDraft.email, name: '', password: '' })
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Authentication failed.')
    } finally {
      setAuthBusy(false)
      setAuthResolved(true)
    }
  }

  function handleSaveDeck(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!deckDraft.title.trim()) return

    const timestamp = new Date().toISOString()
    const previousDeck = deckEditorId ? decks.find((deck) => deck.id === deckEditorId) ?? null : null

    const nextDeck: Deck = {
      color: previousDeck?.color ?? '',
      createdAt: previousDeck?.createdAt ?? timestamp,
      dailyGoal: previousDeck?.dailyGoal ?? 12,
      description: deckDraft.description.trim(),
      examDate: previousDeck?.examDate ?? null,
      id: deckEditorId ?? crypto.randomUUID(),
      tags: previousDeck?.tags ?? [],
      title: deckDraft.title.trim(),
      updatedAt: timestamp,
    }

    setDecks((current) => {
      if (deckEditorId) {
        return current.map((deck) => (deck.id === deckEditorId ? nextDeck : deck))
      }
      return [nextDeck, ...current]
    })

    setActiveDeckId(nextDeck.id)
    setScreen('deck')
    setDeckComposerOpen(false)
    resetDeckComposer()
    pushToast(deckEditorId ? 'Deck saved.' : 'Deck created.')
  }

  function handleDeleteDeck(deckId: string) {
    const targetDeck = decks.find((deck) => deck.id === deckId)
    if (!targetDeck) return
    const confirmed = window.confirm(`Delete "${targetDeck.title}" and all of its cards?`)
    if (!confirmed) return

    const deletedCards = cards.filter((card) => card.deckId === deckId)
    const remainingDecks = decks.filter((deck) => deck.id !== deckId)
    setDecks(remainingDecks)
    setCards((current) => current.filter((card) => card.deckId !== deckId))
    setActiveDeckId(remainingDecks[0]?.id ?? null)
    setScreen('decks')
    setDeckComposerOpen(false)
    resetDeckComposer()
    pushToast('Deck deleted.', 'info', {
      actionLabel: 'Undo',
      duration: 5000,
      onAction: () => {
        setDecks((current) => [targetDeck, ...current])
        setCards((current) => [...deletedCards, ...current])
        setActiveDeckId(targetDeck.id)
        setScreen('deck')
      },
    })
  }

  function resetCardComposer() {
    setCardEditorId(null)
    setCardDraft(emptyCardDraft())
  }

  function openNewCardComposer() {
    resetCardComposer()
    setCardComposerOpen(true)
  }

  function openCardEditor(card: Card) {
    setCardEditorId(card.id)
    setCardDraft({
      back: card.back,
      front: card.front,
      imageUrls: card.imageUrls,
    })
    setCardComposerOpen(true)
  }

  function openCardPreview(card: Card) {
    setPreviewCardId(card.id)
    setPreviewRevealed(false)
  }

  function handleSaveCard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeDeck || !cardDraft.front.trim() || !cardDraft.back.trim()) return

    const timestamp = new Date().toISOString()
    const previousCard = cardEditorId ? cards.find((card) => card.id === cardEditorId) ?? null : null

    const nextCard: Card = {
      back: cardDraft.back.trim(),
      createdAt: previousCard?.createdAt ?? timestamp,
      deckId: activeDeck.id,
      ease: previousCard?.ease ?? 2.3,
      front: cardDraft.front.trim(),
      hint: previousCard?.hint ?? '',
      id: cardEditorId ?? crypto.randomUUID(),
      imageUrls: cardDraft.imageUrls,
      interval: previousCard?.interval ?? 0,
      lapses: previousCard?.lapses ?? 0,
      lastReviewedAt: previousCard?.lastReviewedAt ?? null,
      mastery: previousCard?.mastery ?? 20,
      mnemonic: previousCard?.mnemonic ?? '',
      nextReviewAt: previousCard?.nextReviewAt ?? null,
      reviewCount: previousCard?.reviewCount ?? 0,
      starred: previousCard?.starred ?? false,
      streak: previousCard?.streak ?? 0,
      tags: previousCard?.tags ?? [],
      updatedAt: timestamp,
    }

    setCards((current) => {
      if (cardEditorId) {
        return current.map((card) => (card.id === cardEditorId ? nextCard : card))
      }
      return [nextCard, ...current]
    })

    resetCardComposer()
    setCardComposerOpen(false)
    pushToast(cardEditorId ? 'Card saved.' : 'Card added.')
  }

  function handleDeleteCard(cardId: string) {
    const deletedCard = cards.find((card) => card.id === cardId)
    if (!deletedCard) return

    setCards((current) => current.filter((card) => card.id !== cardId))
    if (cardEditorId === cardId) {
      resetCardComposer()
      setCardComposerOpen(false)
    }
    pushToast('Card deleted.', 'info', {
      actionLabel: 'Undo',
      duration: 5000,
      onAction: () => {
        setCards((current) => [deletedCard, ...current])
      },
    })
  }

  async function handleCardImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files ? [...event.target.files] : []
    if (!files.length) return

    try {
      const dataUrls = await readFilesAsDataUrls(files)
      setCardDraft((current) => ({
        ...current,
        imageUrls: [...current.imageUrls, ...dataUrls],
      }))
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not load the selected image.')
    } finally {
      if (cardImageRef.current) {
        cardImageRef.current.value = ''
      }
    }
  }

  function removeCardImage(indexToRemove: number) {
    setCardDraft((current) => ({
      ...current,
      imageUrls: current.imageUrls.filter((_, index) => index !== indexToRemove),
    }))
    if (cardImageRef.current) {
      cardImageRef.current.value = ''
    }
  }

  function startStudySession(deckId: string) {
    const dueQueue = buildStudyQueue(cards, deckId, 'due')
    const nextQueue = dueQueue.length > 0 ? dueQueue : buildStudyQueue(cards, deckId, 'mixed')

    setActiveDeckId(deckId)
    setScreen('study')
    startTransition(() => {
      setStudyQueue(nextQueue)
      setStudyIndex(0)
      setRevealed(false)
      setTypedAnswer('')
      setAnswerCorrect(null)
      setSessionStats(emptySessionStats())
    })
  }

  function handleReview(rating: Exclude<ReviewRating, 'again'>) {
    if (!currentCard) return

    setCards((current) =>
      current.map((card) => (card.id === currentCard.id ? applyReviewResult(card, rating) : card)),
    )
    setSessionStats((current) => ({
      ...current,
      [rating]: current[rating] + 1,
      reviewed: current.reviewed + 1,
    }))
    setStudyIndex((current) => current + 1)
    setRevealed(false)
    setTypedAnswer('')
    setAnswerCorrect(null)
  }

  function handleCheckTypedAnswer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!currentCard) return
    setAnswerCorrect(isAnswerCorrect(typedAnswer, currentCard.back))
    setRevealed(true)
  }

  const onWindowKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    const isTypingTarget =
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement

    if (screen !== 'study' || isTypingTarget) return

    if (event.code === 'Space') {
      event.preventDefault()
      if (currentCard) {
        setRevealed((value) => !value)
      }
    }

    if (!revealed || !currentCard) return

    if (event.key === '1') {
      event.preventDefault()
      handleReview('hard')
    }

    if (event.key === '2') {
      event.preventDefault()
      handleReview('good')
    }

    if (event.key === '3') {
      event.preventDefault()
      handleReview('easy')
    }
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onWindowKeyDown(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  if (!authResolved) {
    return (
      <div className="auth-shell">
        <section className="auth-panel loading-panel">
          <p className="eyebrow">Flashcraft</p>
          <h1>Loading your decks...</h1>
          <div className="loading-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </section>
      </div>
    )
  }

  if (!sessionUser) {
    return (
      <div className="auth-shell auth-shell-stacked">
        <section className="auth-aside">
          <p className="eyebrow">Flashcraft</p>
          <h1>Simple flashcards, saved to your device.</h1>
          <p className="muted">Create decks, add cards, and study one deck at a time.</p>
        </section>
        <section className="auth-panel">
          <div className="section-heading">
            <h2>{authMode === 'register' ? 'Create account' : 'Sign in'}</h2>
            <span>Progress saves automatically</span>
          </div>
          <form className="stack-form" onSubmit={handleAuthSubmit}>
            {authMode === 'register' && (
              <label>
                <span>Name</span>
                <input
                  type="text"
                  value={authDraft.name}
                  onChange={(event) => setAuthDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Hayat"
                />
              </label>
            )}
            <label>
              <span>Email</span>
              <input
                type="email"
                value={authDraft.email}
                onChange={(event) => setAuthDraft((current) => ({ ...current, email: event.target.value }))}
                placeholder="you@example.com"
              />
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                value={authDraft.password}
                onChange={(event) => setAuthDraft((current) => ({ ...current, password: event.target.value }))}
                placeholder="At least 8 characters"
              />
            </label>
            {authError && <p className="form-error">{authError}</p>}
            <div className="button-row">
              <button className="primary-button" type="submit" disabled={authBusy}>
                {authBusy ? 'Working...' : authMode === 'register' ? 'Create account' : 'Sign in'}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setAuthMode((current) => (current === 'register' ? 'login' : 'register'))
                  setAuthError('')
                }}
              >
                {authMode === 'register' ? 'I already have an account' : 'Create a new account'}
              </button>
            </div>
          </form>
        </section>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-side header-side-left">
          <span className={`save-pill ${syncStatus}`}>{syncStatus === 'saved' ? 'Saved' : syncStatus}</span>
        </div>
        <button className="brand-button" type="button" onClick={() => setScreen('decks')} aria-label="Flashcraft home">
          <span className="brand-mark">F</span>
          <span className="brand-word">lashcraft</span>
        </button>
        <div className="header-side header-side-right">
          <button
            className="secondary-button"
            type="button"
            onClick={() => setScreen(screen === 'settings' ? 'decks' : 'settings')}
          >
            {screen === 'settings' ? 'Done' : 'Settings'}
          </button>
          <span className="account-chip">{sessionUser.name}</span>
        </div>
      </header>

      {syncStatus === 'error' && (
        <section className="status-banner">
          <p>We could not save your latest changes to the account server. Your browser copy is still intact.</p>
        </section>
      )}

      <main className={screen === 'study' ? 'app-main app-main-study' : 'app-main'}>
        {screen === 'decks' && (
          <section className="screen-stack">
            <section className="hero-card">
              <div>
                <p className="eyebrow">My Decks</p>
                <h1>Build a deck, add cards, then study.</h1>
                <p className="muted">Decks, cards, study sessions. Nothing else in the way.</p>
              </div>
              {decks.length > 0 && !deckComposerOpen && (
                <button className="primary-button" type="button" onClick={openNewDeckComposer}>
                  New deck
                </button>
              )}
            </section>

            {deckComposerOpen && (
              <section className="panel">
                <div className="section-heading">
                  <h2>{deckEditorId ? 'Edit deck' : 'Create a deck'}</h2>
                  <span>Keep it simple</span>
                </div>
                <form className="stack-form" onSubmit={handleSaveDeck}>
                  <label>
                    <span>Deck name</span>
                    <input
                      type="text"
                      value={deckDraft.title}
                      onChange={(event) => setDeckDraft((current) => ({ ...current, title: event.target.value }))}
                      placeholder="Biology revision"
                    />
                  </label>
                  <label>
                    <span>Description</span>
                    <textarea
                      rows={3}
                      value={deckDraft.description}
                      onChange={(event) => setDeckDraft((current) => ({ ...current, description: event.target.value }))}
                      placeholder="Optional note about what this deck is for."
                    />
                  </label>
                  <div className="button-row">
                    <button className="primary-button" type="submit">
                      {deckEditorId ? 'Save deck' : 'Create deck'}
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => {
                        setDeckComposerOpen(false)
                        resetDeckComposer()
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </section>
            )}

            {!decks.length && !deckComposerOpen ? (
              <section className="empty-card">
                <div className="empty-illustration" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <h2>No decks yet.</h2>
                <p>Create your first deck to start adding flashcards.</p>
                <button className="primary-button" type="button" onClick={openNewDeckComposer}>
                  Create first deck
                </button>
              </section>
            ) : !decks.length ? null : (
              <section className="deck-grid">
                {decks.map((deck) => {
                  const deckCardCount = cards.filter((card) => card.deckId === deck.id).length
                  const dueCount = cards.filter((card) => card.deckId === deck.id && isDue(card)).length

                  return (
                    <article key={deck.id} className="deck-card">
                      <div className="deck-card-copy">
                        <p className="eyebrow">Deck</p>
                        <h2>{deck.title}</h2>
                        <p className="muted">{deck.description || 'No description yet.'}</p>
                      </div>
                      <div className="deck-stats">
                        <span>{deckCardCount} cards</span>
                        <span>{dueCount} due</span>
                      </div>
                      <div className="button-row">
                        <button className="primary-button" type="button" onClick={() => openDeck(deck.id)}>
                          Open
                        </button>
                        <button className="secondary-button" type="button" onClick={() => startStudySession(deck.id)}>
                          Study
                        </button>
                      </div>
                    </article>
                  )
                })}
              </section>
            )}
          </section>
        )}

        {screen === 'deck' && activeDeck && (
          <section className="screen-stack">
            <section className="deck-page-header">
              <div>
                <button className="text-link" type="button" onClick={() => setScreen('decks')}>
                  Back to decks
                </button>
                <h1>{activeDeck.title}</h1>
                <p className="muted">{activeDeck.description || 'Add cards and study this deck when you are ready.'}</p>
              </div>
              <div className="button-row">
                <button className="primary-button" type="button" onClick={() => startStudySession(activeDeck.id)}>
                  Study this deck
                </button>
                <button className="secondary-button" type="button" onClick={() => openDeckEditor(activeDeck)}>
                  Edit deck
                </button>
              </div>
            </section>

            {deckComposerOpen && deckEditorId === activeDeck.id && (
              <section className="panel">
                <div className="section-heading">
                  <h2>Edit deck</h2>
                  <span>Deck details</span>
                </div>
                <form className="stack-form" onSubmit={handleSaveDeck}>
                  <label>
                    <span>Deck name</span>
                    <input
                      type="text"
                      value={deckDraft.title}
                      onChange={(event) => setDeckDraft((current) => ({ ...current, title: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Description</span>
                    <textarea
                      rows={3}
                      value={deckDraft.description}
                      onChange={(event) => setDeckDraft((current) => ({ ...current, description: event.target.value }))}
                    />
                  </label>
                  <div className="button-row">
                    <button className="primary-button" type="submit">
                      Save deck
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => {
                        setDeckComposerOpen(false)
                        resetDeckComposer()
                      }}
                    >
                      Close
                    </button>
                    <button className="danger-button" type="button" onClick={() => handleDeleteDeck(activeDeck.id)}>
                      Delete deck
                    </button>
                  </div>
                </form>
              </section>
            )}

            <section className="deck-summary">
              <article className="summary-card">
                <strong>{deckCards.length}</strong>
                <span>Cards</span>
              </article>
              <article className="summary-card">
                <strong>{deckCards.filter((card) => isDue(card)).length}</strong>
                <span>Due</span>
              </article>
            </section>

            <section className="deck-tools">
              <article className="panel">
                <div className="section-heading">
                  <h2>{cardEditorId ? 'Edit card' : 'Add a card'}</h2>
                  <span>Create or update a flashcard</span>
                </div>
                {!cardComposerOpen ? (
                  <button className="primary-button" type="button" onClick={openNewCardComposer}>
                    Add card
                  </button>
                ) : (
                  <form className="stack-form" onSubmit={handleSaveCard}>
                    <label>
                      <span>Question</span>
                      <textarea
                        rows={3}
                        value={cardDraft.front}
                        onChange={(event) => setCardDraft((current) => ({ ...current, front: event.target.value }))}
                        placeholder="What do you want to remember?"
                      />
                    </label>
                    <label>
                      <span>Answer</span>
                      <textarea
                        rows={5}
                        value={cardDraft.back}
                        onChange={(event) => setCardDraft((current) => ({ ...current, back: event.target.value }))}
                        placeholder="Write the answer here."
                      />
                    </label>
                    <input
                      ref={cardImageRef}
                      className="hidden-input"
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleCardImageChange}
                    />
                    <button className="secondary-button" type="button" onClick={() => cardImageRef.current?.click()}>
                      {cardDraft.imageUrls.length ? 'Add more images' : 'Add images'}
                    </button>
                    {cardDraft.imageUrls.length > 0 && (
                      <div className="image-grid">
                        {cardDraft.imageUrls.map((imageUrl, index) => (
                          <div key={`${imageUrl}-${index}`} className="image-preview">
                            <img src={imageUrl} alt={`Card image ${index + 1}`} />
                            <button
                              className="image-remove-button"
                              type="button"
                              aria-label="Remove image"
                              onClick={() => removeCardImage(index)}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="button-row">
                      <button className="primary-button" type="submit">
                        {cardEditorId ? 'Save card' : 'Add card'}
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => {
                          resetCardComposer()
                          setCardComposerOpen(false)
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </article>

            </section>

            <section className="panel">
              <div className="section-heading">
                <h2>Cards</h2>
                <span>{filteredDeckCards.length} shown</span>
              </div>
              <label className="search-field">
                <span>Search</span>
                <input
                  type="search"
                  value={cardSearch}
                  onChange={(event) => setCardSearch(event.target.value)}
                  placeholder="Search question or answer"
                />
              </label>
              {!filteredDeckCards.length ? (
                <div className="empty-card small">
                  <p>No cards yet in this deck.</p>
                </div>
              ) : (
                <div className="card-list">
                  {filteredDeckCards.map((card) => (
                    <article key={card.id} className="card-row">
                      <div className="card-row-copy">
                        <strong>{card.front}</strong>
                        <p>{card.back}</p>
                        {card.imageUrls.length > 0 && (
                          <div className="image-strip">
                            {card.imageUrls.slice(0, 3).map((imageUrl, index) => (
                              <div key={`${card.id}-${index}`} className="image-thumb">
                                <img src={imageUrl} alt="" />
                              </div>
                            ))}
                          </div>
                        )}
                        <span className="muted">{formatRelativeReview(card.nextReviewAt)}</span>
                      </div>
                      <div className="button-column">
                        <button className="secondary-button" type="button" onClick={() => openCardPreview(card)}>
                          Preview
                        </button>
                        <button className="secondary-button" type="button" onClick={() => openCardEditor(card)}>
                          Edit
                        </button>
                        <button className="danger-button subtle" type="button" onClick={() => handleDeleteCard(card.id)}>
                          Delete
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </section>
        )}

        {screen === 'study' && activeDeck && (
          <section className="study-screen">
            <div className="study-topbar">
              <button className="text-link" type="button" onClick={() => setScreen('deck')}>
                Back to deck
              </button>
              <span className="muted">
                {Math.min(studyIndex + 1, studyQueue.length)} of {studyQueue.length || 0}
              </span>
            </div>

            <div className="study-title">
              <p className="eyebrow">Study</p>
              <h1>{activeDeck.title}</h1>
            </div>

            <section className="study-progress panel">
              <div className="study-progress-copy">
                <strong>{studyProgress}% complete</strong>
                <span>
                  {sessionStats.reviewed} reviewed, {Math.max(0, studyQueue.length - studyIndex)} remaining
                </span>
              </div>
              <div className="progress-track" aria-hidden="true">
                <span style={{ width: `${studyProgress}%` }} />
              </div>
            </section>

            {!studyQueue.length && (
              <div className="empty-card">
                <div className="empty-illustration" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <h2>No cards ready yet.</h2>
                <p>Add some cards to this deck, then start studying.</p>
              </div>
            )}

            {sessionComplete && (
              <div className="empty-card">
              <div className="empty-illustration celebration" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <h2>Session complete.</h2>
                <p>
                  Reviewed {sessionStats.reviewed} cards. Hard: {sessionStats.hard}, medium: {sessionStats.good}, easy:{' '}
                  {sessionStats.easy}.
                </p>
                <div className="button-row">
                  <button className="primary-button" type="button" onClick={() => startStudySession(activeDeck.id)}>
                    Study again
                  </button>
                  <button className="secondary-button" type="button" onClick={() => setScreen('deck')}>
                    Back to deck
                  </button>
                </div>
              </div>
            )}

            {currentCard && (
              <>
                <button
                  key={currentCard.id}
                  className={revealed ? 'study-card revealed' : 'study-card'}
                  type="button"
                  onClick={() => setRevealed((value) => !value)}
                >
                  <div className="flip-card-shell">
                    <div className={`flip-card-face flip-card-front${currentCard.imageUrls.length > 0 ? ' has-image' : ''}`}>
                      {currentCard.imageUrls[0] && (
                        <div
                          className="flip-card-bg"
                          style={{ backgroundImage: `url(${currentCard.imageUrls[0]})` }}
                        />
                      )}
                      <p className="eyebrow">Question</p>
                      <div className="study-copy">
                        <h2>{currentCard.front}</h2>
                        <span className="muted">Tap to reveal the answer</span>
                      </div>
                    </div>
                    <div className={`flip-card-face flip-card-back${currentCard.imageUrls.length > 0 ? ' has-image' : ''}`}>
                      {currentCard.imageUrls[0] && (
                        <div
                          className="flip-card-bg"
                          style={{ backgroundImage: `url(${currentCard.imageUrls[0]})` }}
                        />
                      )}
                      <p className="eyebrow">Answer</p>
                      <div className="study-copy">
                        <h2>{currentCard.back}</h2>
                        <span className="muted">Tap to see the question again</span>
                      </div>
                    </div>
                  </div>
                </button>

                <div className="study-actions">
                  {!revealed && (
                    <form className="answer-form" onSubmit={handleCheckTypedAnswer}>
                      <label className="answer-input-label">
                        <span>Type your answer, or tap the card to flip it</span>
                        <textarea
                          rows={2}
                          value={typedAnswer}
                          onChange={(event) => setTypedAnswer(event.target.value)}
                          placeholder="Your answer..."
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                              event.preventDefault()
                              ;(event.currentTarget.form as HTMLFormElement | null)?.requestSubmit()
                            }
                          }}
                        />
                      </label>
                      <button className="primary-button" type="submit" disabled={!typedAnswer.trim()}>
                        Check answer
                      </button>
                    </form>
                  )}

                  {revealed && answerCorrect !== null && (
                    <div className={`answer-result ${answerCorrect ? 'correct' : 'incorrect'}`}>
                      <strong>{answerCorrect ? 'Correct' : 'Not quite'}</strong>
                      {!answerCorrect && (
                        <p>
                          You wrote: <em>{typedAnswer || '(blank)'}</em>
                        </p>
                      )}
                    </div>
                  )}

                  {revealed && (
                    <div className="button-row center">
                      <button className="danger-button" type="button" onClick={() => handleReview('hard')}>
                        Hard
                      </button>
                      <button className="secondary-button" type="button" onClick={() => handleReview('good')}>
                        Medium
                      </button>
                      <button className="primary-button" type="button" onClick={() => handleReview('easy')}>
                        Easy
                      </button>
                    </div>
                  )}

                  <p className="study-hint muted">Keyboard: <code>space</code> to flip, <code>1</code> hard, <code>2</code> medium, <code>3</code> easy.</p>
                </div>
              </>
            )}
          </section>
        )}

        {screen === 'settings' && (
          <section className="screen-stack">
            <section className="hero-card">
              <div>
                <p className="eyebrow">Settings</p>
                <h1>Make Flashcraft your own.</h1>
                <p className="muted">Pick a color theme. Your choice is saved on this device.</p>
              </div>
              <button className="secondary-button" type="button" onClick={() => setScreen('decks')}>
                Back to decks
              </button>
            </section>

            <section className="panel">
              <div className="section-heading">
                <h2>Theme</h2>
                <span>Five looks, one click to switch</span>
              </div>
              <div className="theme-picker">
                {THEMES.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`theme-swatch${theme === option.id ? ' active' : ''}`}
                    onClick={() => setTheme(option.id)}
                  >
                    <div className="theme-swatch-preview" aria-hidden="true">
                      {option.swatch.map((color, index) => (
                        <span key={index} style={{ background: color }} />
                      ))}
                    </div>
                    <div className="theme-swatch-name">
                      <span>{option.name}</span>
                      {theme === option.id && <span className="theme-swatch-check">Selected</span>}
                    </div>
                    <span className="muted">{option.blurb}</span>
                  </button>
                ))}
              </div>
            </section>
          </section>
        )}
      </main>

      {previewCard && (
        <div className="preview-overlay" role="dialog" aria-modal="true">
          <div className="preview-panel">
            <div className="preview-topbar">
              <div>
                <p className="eyebrow">Card preview</p>
                <h2>{activeDeck?.title ?? 'Deck'}</h2>
              </div>
              <button className="secondary-button" type="button" onClick={() => setPreviewCardId(null)}>
                Close
              </button>
            </div>
            <button
              className={previewRevealed ? 'study-card revealed' : 'study-card'}
              type="button"
              onClick={() => setPreviewRevealed((value) => !value)}
            >
              <div className="flip-card-shell preview-flip-card">
                <div className={`flip-card-face flip-card-front${previewCard.imageUrls.length > 0 ? ' has-image' : ''}`}>
                  {previewCard.imageUrls[0] && (
                    <div
                      className="flip-card-bg"
                      style={{ backgroundImage: `url(${previewCard.imageUrls[0]})` }}
                    />
                  )}
                  <p className="eyebrow">Question</p>
                  <div className="study-copy">
                    <h2>{previewCard.front}</h2>
                    <span className="muted">Tap to flip to the answer</span>
                  </div>
                </div>
                <div className={`flip-card-face flip-card-back${previewCard.imageUrls.length > 0 ? ' has-image' : ''}`}>
                  {previewCard.imageUrls[0] && (
                    <div
                      className="flip-card-bg"
                      style={{ backgroundImage: `url(${previewCard.imageUrls[0]})` }}
                    />
                  )}
                  <p className="eyebrow">Answer</p>
                  <div className="study-copy">
                    <h2>{previewCard.back}</h2>
                    <span className="muted">Tap to flip back to the question</span>
                  </div>
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.tone}`} role="status" aria-live="polite">
          <span>{toast.message}</span>
          {toast.actionLabel && toast.onAction && (
            <button
              className="toast-action"
              type="button"
              onClick={() => {
                toast.onAction?.()
                setToast(null)
              }}
            >
              {toast.actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default App
