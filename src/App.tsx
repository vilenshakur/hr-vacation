import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import {
  ArrowDownToLine, ArrowRight, BriefcaseBusiness, CalendarDays, Check, ChevronDown,
  ChevronLeft, ChevronRight, CircleCheck, CircleX, Clock3, FileText, KeyRound,
  LogOut, MoonStar, Paperclip, Plus, Search, ShieldCheck, Sun, UsersRound, Wallet, X,
} from 'lucide-react'
import { localeByLanguage, t, type Language, type Theme, type TranslationKey } from './i18n'
import './App.css'

type Role = 'employee' | 'manager' | 'hr'
type User = { id: number; name: string; email: string; role: Role }
type HistoryEntry = { id: number; action: string; comment: string; created_at: string; actor_name: string; actor_role: Role }
type Attachment = { id: number; original_name: string; mime_type: string; size: number; created_at: string }
type VacationRequest = {
  id: number; employee_id: number; employee_name: string; start_date: string; end_date: string
  days: number; leave_type: string; note: string; status: string; created_at: string
  history: HistoryEntry[]; attachments: Attachment[]
}
type Modal = { type: 'create' } | { type: 'details'; request: VacationRequest } | { type: 'decision'; request: VacationRequest; decision: 'approve' | 'reject' } | null
type AuthChallenge = { challengeToken: string; setupRequired: boolean; secret?: string; qrDataUrl?: string }

const demoAccounts = [
  { role: 'employee' as const, email: 'employee@hr.local', label: 'demoEmployee' as const, caption: 'employee' as const },
  { role: 'employee' as const, email: 'employee2@hr.local', label: 'demoEmployee2' as const, caption: 'employee' as const },
  { role: 'employee' as const, email: 'employee3@hr.local', label: 'demoEmployee3' as const, caption: 'employee' as const },
  { role: 'manager' as const, email: 'manager@hr.local', label: 'demoManager' as const, caption: 'manager' as const },
  { role: 'manager' as const, email: 'manager2@hr.local', label: 'demoManager2' as const, caption: 'manager' as const },
  { role: 'hr' as const, email: 'hr@hr.local', label: 'demoHr' as const, caption: 'hr' as const },
]
const password = 'Vacation2026!'
const today = new Date()
const todayIso = today.toISOString().slice(0, 10)

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const isFormData = options.body instanceof FormData
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || 'Не удалось выполнить запрос')
  }
  return response.status === 204 ? undefined as T : response.json()
}

function dateLabel(value: string, language: Language) {
  if (language === 'kk') return localizedDate(parseIsoDate(value.slice(0, 10)), language, 'short')
  return new Intl.DateTimeFormat(localeByLanguage[language], { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(`${value.slice(0, 10)}T12:00:00`)).replace(' г.', '')
}

function parseIsoDate(value: string) {
  return new Date(`${value}T12:00:00`)
}

function isoDate(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const kazakhMonths = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан']
const kazakhWeekdays = ['жексенбі', 'дүйсенбі', 'сейсенбі', 'сәрсенбі', 'бейсенбі', 'жұма', 'сенбі']

function localizedDate(date: Date, language: Language, format: 'short' | 'long' | 'month' | 'weekday' = 'short') {
  if (language !== 'kk') {
    const options: Intl.DateTimeFormatOptions = format === 'month' ? { month: 'long', year: 'numeric' }
      : format === 'weekday' ? { weekday: 'long', day: 'numeric', month: 'long' }
        : { day: 'numeric', month: format === 'short' ? 'short' : 'long', year: 'numeric' }
    return new Intl.DateTimeFormat(localeByLanguage[language], options).format(date).replace(' г.', '')
  }
  const day = date.getDate()
  const month = kazakhMonths[date.getMonth()]
  if (format === 'month') return `${month} ${date.getFullYear()}`
  if (format === 'weekday') return `${day} ${month} ${date.getFullYear()}, ${kazakhWeekdays[date.getDay()]}`
  return `${day} ${month} ${date.getFullYear()}`
}

function fileSizeLabel(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

type DatePickerFieldProps = {
  language: Language
  label: string
  name: string
  value: string
  minDate: string
  onChange: (value: string) => void
}

function DatePickerField({ language, label, name, value, minDate, onChange }: DatePickerFieldProps) {
  const [open, setOpen] = useState(false)
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const rootRef = useRef<HTMLDivElement>(null)
  const minimum = parseIsoDate(minDate)
  const minimumMonth = new Date(minimum.getFullYear(), minimum.getMonth(), 1)
  const monthStart = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1)
  const leadingDays = (monthStart.getDay() + 6) % 7
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate()
  const calendarCells = Array.from({ length: leadingDays + daysInMonth }, (_, index) =>
    index < leadingDays ? null : new Date(monthStart.getFullYear(), monthStart.getMonth(), index - leadingDays + 1),
  )
  const canGoBack = monthStart > minimumMonth
  const selectedLabel = value
    ? localizedDate(parseIsoDate(value), language, 'long')
    : t(language, 'chooseDate')

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('click', closeOnOutsideClick)
    return () => document.removeEventListener('click', closeOnOutsideClick)
  }, [open])

  function showCalendar() {
    const startingDate = value || minDate
    const date = parseIsoDate(startingDate)
    setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1))
    setOpen((current) => !current)
  }

  function selectDate(date: Date) {
    onChange(isoDate(date))
    setOpen(false)
  }

  const weekdays = t(language, 'dayNames').split(',')

  return (
    <div className="picker-field" ref={rootRef} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }}>
      <span className="picker-label">{label}</span>
      <input type="hidden" name={name} value={value} />
      <button type="button" className={`picker-trigger ${value ? 'picker-has-value' : ''}`} onClick={showCalendar} aria-haspopup="dialog" aria-expanded={open}>
        <span>{selectedLabel}</span><CalendarDays size={17} aria-hidden="true" />
      </button>
      {open && <div className="calendar-popover" role="dialog" aria-label={`${label}`}>
        <div className="calendar-heading">
          <strong>{localizedDate(visibleMonth, language, 'month')}</strong>
          <div className="calendar-navigation">
            <button type="button" aria-label={t(language, 'previousMonth')} disabled={!canGoBack} onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}><ChevronLeft size={17} /></button>
            <button type="button" aria-label={t(language, 'nextMonth')} onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))}><ChevronRight size={17} /></button>
          </div>
        </div>
        <div className="calendar-grid calendar-weekdays" aria-hidden="true">{weekdays.map((day) => <span key={day}>{day}</span>)}</div>
        <div className="calendar-grid calendar-days">
          {calendarCells.map((date, index) => {
            if (!date) return <span className="calendar-empty" key={`empty-${index}`} />
            const dateValue = isoDate(date)
            const isSelected = dateValue === value
            const isToday = dateValue === todayIso
            return <button type="button" key={dateValue} disabled={dateValue < minDate} aria-label={localizedDate(date, language, 'weekday')} aria-pressed={isSelected} className={`calendar-day ${isSelected ? 'day-selected' : ''} ${isToday ? 'day-today' : ''}`} onClick={() => selectDate(date)}>{date.getDate()}</button>
          })}
        </div>
        <div className="calendar-footer"><span>{t(language, 'chooseDay')}</span><button type="button" disabled={todayIso < minDate} onClick={() => selectDate(today)}>{t(language, 'today')}</button></div>
      </div>}
    </div>
  )
}

function DateRangePicker({ language }: { language: Language }) {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  function updateStartDate(value: string) {
    setStartDate(value)
    if (endDate && endDate < value) setEndDate('')
  }

  return <div className="date-fields">
    <DatePickerField language={language} label={t(language, 'startDate')} name="startDate" value={startDate} minDate={todayIso} onChange={updateStartDate} />
    <DatePickerField language={language} label={t(language, 'endDate')} name="endDate" value={endDate} minDate={startDate || todayIso} onChange={setEndDate} />
  </div>
}

const leaveOptions: { value: string; title: TranslationKey; description: TranslationKey; Icon: typeof Sun }[] = [
  { value: 'Ежегодный отпуск', title: 'annualLeave', description: 'annualDescription', Icon: Sun },
  { value: 'За свой счёт', title: 'unpaidLeave', description: 'unpaidDescription', Icon: Wallet },
  { value: 'Другое', title: 'otherLeave', description: 'otherDescription', Icon: BriefcaseBusiness },
]

function LeaveTypePicker({ language }: { language: Language }) {
  const [selected, setSelected] = useState(leaveOptions[0])
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('click', closeOnOutsideClick)
    return () => document.removeEventListener('click', closeOnOutsideClick)
  }, [open])

  const SelectedIcon = selected.Icon
  return (
    <div className="picker-field leave-type-picker" ref={rootRef} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }}>
      <span className="picker-label">{t(language, 'leaveType')}</span>
      <input type="hidden" name="leaveType" value={selected.value} />
      <button type="button" className="picker-trigger leave-type-trigger" role="combobox" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span className="leave-selected-icon"><SelectedIcon size={17} /></span><span className="leave-selected-text">{t(language, selected.title)}</span><ChevronDown className={open ? 'chevron-open' : ''} size={16} />
      </button>
      {open && <div className="leave-options" role="listbox" aria-label={t(language, 'leaveType')}>
        {leaveOptions.map((option) => {
          const OptionIcon = option.Icon
          const isSelected = option.value === selected.value
          return <button type="button" key={option.value} role="option" aria-selected={isSelected} className={`leave-option ${isSelected ? 'leave-option-selected' : ''}`} onClick={() => { setSelected(option); setOpen(false) }}>
            <span className="leave-option-icon"><OptionIcon size={17} /></span><span className="leave-option-copy"><strong>{t(language, option.title)}</strong><small>{t(language, option.description)}</small></span>{isSelected && <Check size={16} />}
          </button>
        })}
      </div>}
    </div>
  )
}

type AppearanceControlsProps = {
  language: Language
  theme: Theme
  onLanguageChange: (language: Language) => void
  onThemeChange: (theme: Theme) => void
}

function AppearanceControls({ language, theme, onLanguageChange, onThemeChange }: AppearanceControlsProps) {
  const ThemeIcon = theme === 'dark' ? Sun : MoonStar
  const nextTheme = theme === 'dark' ? 'light' : 'dark'
  return <div className="appearance-controls">
    <button type="button" className="theme-toggle" title={t(language, theme === 'dark' ? 'lightTheme' : 'darkTheme')} aria-label={t(language, theme === 'dark' ? 'lightTheme' : 'darkTheme')} onClick={() => onThemeChange(nextTheme)}>
      <ThemeIcon size={17} />
    </button>
    <label className="language-control">
      <span className="visually-hidden">{t(language, 'language')}</span>
      <select aria-label={t(language, 'language')} value={language} onChange={(event) => onLanguageChange(event.target.value as Language)}>
        <option value="ru">RU</option><option value="en">EN</option><option value="kk">ҚАЗ</option>
      </select>
      <ChevronDown size={13} aria-hidden="true" />
    </label>
  </div>
}

const roleTranslationKey: Record<Role, TranslationKey> = {
  employee: 'employee', manager: 'manager', hr: 'hr',
}

const statusTranslationKey: Record<string, TranslationKey> = {
  manager_pending: 'pendingManager', hr_pending: 'pendingHr', approved: 'approvedStatus', rejected: 'rejectedStatus',
}

const historyTranslationKey: Record<string, TranslationKey> = {
  submitted: 'submitted', manager_approved: 'managerApproved', hr_approved: 'hrApproved', rejected: 'requestRejected',
}

const leaveTranslationKey: Record<string, TranslationKey> = {
  'Ежегодный отпуск': 'annualLeave', 'За свой счёт': 'unpaidLeave', Другое: 'otherLeave',
}

function dayCountLabel(days: number, language: Language) {
  if (language === 'en') return t(language, days === 1 ? 'oneDay' : 'manyDays')
  if (language === 'kk') return t(language, 'manyDays')
  const remainder = days % 10
  const teen = days % 100
  return t(language, remainder === 1 && teen !== 11 ? 'oneDay' : remainder >= 2 && remainder <= 4 && (teen < 12 || teen > 14) ? 'fewDays' : 'manyDays')
}

function localizedError(issue: unknown, language: Language) {
  const message = issue instanceof Error ? issue.message : ''
  const errorKeys: Record<string, TranslationKey> = {
    'Неверная почта или пароль.': 'loginError',
    'Войдите в систему, чтобы продолжить.': 'sessionRequired',
    'Проверьте даты отпуска.': 'invalidDates',
    'Дата начала не может быть в прошлом.': 'pastDate',
    'В выбранном диапазоне нет рабочих дней.': 'noWorkdays',
    'Выберите тип отсутствия.': 'leaveTypeRequired',
    'Для отказа укажите причину.': 'rejectCommentRequired',
    'Неверный код MFA.': 'invalidMfa',
    'Срок проверки MFA истёк. Войдите ещё раз.': 'mfaExpired',
    'Файл не поддерживается или превышен лимит загрузки.': 'uploadError',
  }
  return errorKeys[message] ? t(language, errorKeys[message]) : message || t(language, 'notFound')
}

function App() {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = window.localStorage.getItem('vacation-language')
    return saved === 'en' || saved === 'kk' ? saved : 'ru'
  })
  const [theme, setTheme] = useState<Theme>(() => window.localStorage.getItem('vacation-theme') === 'dark' ? 'dark' : 'light')
  const [user, setUser] = useState<User | null>(null)
  const [requests, setRequests] = useState<VacationRequest[]>([])
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<Modal>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loginEmail, setLoginEmail] = useState(demoAccounts[0].email)
  const [loginPassword, setLoginPassword] = useState(password)
  const [authChallenge, setAuthChallenge] = useState<AuthChallenge | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.lang = localeByLanguage[language]
    document.title = `${t(language, 'appName')} — ${language === 'ru' ? 'HR-сервис' : language === 'en' ? 'People service' : 'HR қызметі'}`
    window.localStorage.setItem('vacation-theme', theme)
    window.localStorage.setItem('vacation-language', language)
  }, [language, theme])

  const loadRequests = useCallback(async () => {
    const result = await api<{ requests: VacationRequest[] }>('/api/requests')
    setRequests(result.requests)
  }, [])

  useEffect(() => {
    api<{ user: User | null }>('/api/me')
      .then(({ user: current }) => {
        if (!current) return
        setUser(current)
        return loadRequests()
      })
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [loadRequests])

  const visibleRequests = useMemo(() => requests.filter((request) => {
    const matchesFilter = filter === 'all'
      || (filter === 'waiting' && ['manager_pending', 'hr_pending'].includes(request.status))
      || request.status === filter
    const matchesQuery = `${request.employee_name} ${request.leave_type} ${request.note}`.toLowerCase().includes(query.toLowerCase())
    return matchesFilter && matchesQuery
  }), [filter, query, requests])

  const pendingCount = requests.filter((item) =>
    user?.role === 'manager' ? item.status === 'manager_pending'
      : user?.role === 'hr' ? item.status === 'hr_pending'
        : ['manager_pending', 'hr_pending'].includes(item.status),
  ).length

  async function handleLogin(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await api<{ user: User; mfaRequired: boolean; mfaSetupRequired: boolean; challengeToken: string; secret?: string; qrDataUrl?: string }>('/api/login', {
        method: 'POST', body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      })
      if (result.mfaRequired) {
        setAuthChallenge({
          challengeToken: result.challengeToken,
          setupRequired: result.mfaSetupRequired,
          secret: result.secret,
          qrDataUrl: result.qrDataUrl,
        })
        return
      }
      setUser(result.user)
      await loadRequests()
    } catch (issue) {
      setError(localizedError(issue, language))
    } finally { setBusy(false) }
  }

  async function completeMfa(event: FormEvent) {
    event.preventDefault()
    if (!authChallenge) return
    setBusy(true)
    setError('')
    try {
      const result = await api<{ user: User }>('/api/login/mfa', {
        method: 'POST', body: JSON.stringify({ challengeToken: authChallenge.challengeToken, code: mfaCode }),
      })
      setAuthChallenge(null)
      setMfaCode('')
      setUser(result.user)
      await loadRequests()
    } catch (issue) {
      setError(localizedError(issue, language))
    } finally { setBusy(false) }
  }

  async function handleLogout() {
    await api('/api/logout', { method: 'POST' }).catch(() => undefined)
    setUser(null)
    setRequests([])
  }

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      await api('/api/requests', {
        method: 'POST',
        body: form,
      })
      await loadRequests()
      setSelectedFiles([])
      setModal(null)
    } catch (issue) {
      setError(localizedError(issue, language))
    } finally { setBusy(false) }
  }

  function updateSelectedFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? [])
    if (files.length > 5 || files.some((file) => file.size > 10 * 1024 * 1024)) {
      setError(localizedError(new Error('Файл не поддерживается или превышен лимит загрузки.'), language))
      event.currentTarget.value = ''
      setSelectedFiles([])
      return
    }
    setError('')
    setSelectedFiles(files)
  }

  function removeSelectedFile(index: number) {
    const nextFiles = selectedFiles.filter((_file, fileIndex) => fileIndex !== index)
    const transfer = new DataTransfer()
    nextFiles.forEach((file) => transfer.items.add(file))
    if (attachmentInputRef.current) attachmentInputRef.current.files = transfer.files
    setSelectedFiles(nextFiles)
  }

  async function submitDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (modal?.type !== 'decision') return
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      await api(`/api/requests/${modal.request.id}/decision`, {
        method: 'POST', body: JSON.stringify({ decision: modal.decision, comment: form.get('comment') }),
      })
      await loadRequests()
      setModal(null)
    } catch (issue) {
      setError(localizedError(issue, language))
    } finally { setBusy(false) }
  }

  if (loading) return <div className="loading-screen"><span className="brand-mark">o</span><span>Загружаем кабинет</span></div>

  if (!user) return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-brand"><span className="brand-mark">o</span><span>{t(language, 'appName')}<span className="brand-dot">.</span></span></div>
        <div className="login-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> {t(language, 'heroEyebrow')}</div>
          <h1>{t(language, 'heroTitleOne')}<br /><em>{t(language, 'heroTitleTwo')}</em></h1>
          <p>{t(language, 'heroText')}</p>
          <div className="login-art" aria-hidden="true">
            <div className="sun-disc" /><div className="art-horizon" />
            <div className="art-note"><CalendarDays size={17} /><span>{t(language, 'heroNote')}</span></div>
            <div className="art-date">2026<br /><strong>{language === 'ru' ? 'лето' : language === 'en' ? 'summer' : 'жаз'}</strong></div>
          </div>
          <div className="login-foot"><ShieldCheck size={16} /> {t(language, 'privateTeam')}</div>
        </div>
      </section>
      <section className="login-form-area">
        <div className="auth-controls"><AppearanceControls language={language} theme={theme} onLanguageChange={setLanguage} onThemeChange={setTheme} /></div>
        <div className="login-form-wrap">
          <div className="mobile-brand"><span className="brand-mark">o</span><span>{t(language, 'appName')}<span className="brand-dot">.</span></span></div>
          <div className="form-kicker">{t(language, 'workspaceHeading')}</div>
          <h2>{t(language, 'welcome')}</h2>
          <p className="form-subtitle">{t(language, 'loginPrompt')}</p>
          {authChallenge ? <form onSubmit={completeMfa} className="login-form mfa-form">
            <div className="mfa-heading"><span className="mfa-icon"><KeyRound size={18} /></span><span><strong>{t(language, authChallenge.setupRequired ? 'mfaSetupTitle' : 'mfaTitle')}</strong><small>{authChallenge.setupRequired ? t(language, 'mfaSetupText') : loginEmail}</small></span></div>
            {authChallenge.setupRequired && authChallenge.qrDataUrl && <div className="mfa-qr-wrap"><img className="mfa-qr" src={authChallenge.qrDataUrl} alt={t(language, 'mfaSetupTitle')} /><span>{t(language, 'mfaManual')}<strong>{authChallenge.secret}</strong></span></div>}
            <label>{t(language, 'mfaCode')}<input type="text" inputMode="numeric" autoComplete="one-time-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} minLength={6} maxLength={6} pattern="[0-9]{6}" autoFocus required /></label>
            {error && <div className="form-error">{localizedError(new Error(error), language)}</div>}
            <button className="button button-primary login-submit" disabled={busy || mfaCode.length !== 6}>{busy ? t(language, 'mfaVerifying') : <>{t(language, 'mfaVerify')} <ArrowRight size={17} /></>}</button>
            <button type="button" className="button button-quiet mfa-back" onClick={() => { setAuthChallenge(null); setMfaCode(''); setError('') }}>{t(language, 'mfaBack')}</button>
          </form> : <form onSubmit={handleLogin} className="login-form">
            <label>{t(language, 'email')}<input type="email" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} required autoComplete="username" /></label>
            <label>{t(language, 'password')}<input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required autoComplete="current-password" /></label>
            {error && <div className="form-error">{error}</div>}
            <button className="button button-primary login-submit" disabled={busy}>{busy ? t(language, 'signingIn') : <>{t(language, 'signIn')} <ArrowRight size={17} /></>}</button>
          </form>}
          {!authChallenge && <div className="demo-login">
            <div className="demo-heading"><span>{t(language, 'demoAccess')}</span><span className="demo-rule" /></div>
            <div className="demo-users">
              {demoAccounts.map((account) => {
                const label = t(language, account.label)
                return <button key={account.email} className="demo-user" onClick={() => { setLoginEmail(account.email); setLoginPassword(password); setError('') }}>
                  <span className={`demo-avatar avatar-${account.role}`}>{label.split(' ').map((part) => part[0]).join('')}</span>
                  <span className="demo-user-text"><strong>{label}</strong><small>{t(language, account.caption)}</small></span>
                  <ChevronRight size={16} />
                </button>
              })}
            </div>
            <p className="demo-hint">{t(language, 'demoPassword')} <strong>Vacation2026!</strong></p>
          </div>}
          <p className="login-legal">{authChallenge ? t(language, authChallenge.setupRequired ? 'mfaSetupPending' : 'mfaEnabled') : t(language, 'legal')}</p>
        </div>
      </section>
    </main>
  )

  const roleHeading = t(language, user.role === 'employee' ? 'myRequests' : user.role === 'manager' ? 'teamRequests' : 'allRequests')
  const needsMyReview = user.role === 'manager' || user.role === 'hr'
  const tabs = [
    { key: 'all', label: t(language, 'all') },
    { key: 'waiting', label: t(language, needsMyReview ? 'requireDecision' : 'inProgress') },
    { key: 'approved', label: t(language, 'approved') }, { key: 'rejected', label: t(language, 'rejected') },
  ]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="sidebar-brand" href="#top"><span className="brand-mark">o</span><span>{t(language, 'appName')}<span className="brand-dot">.</span></span></a>
        <div className="workspace-label">{t(language, 'workspaceHeading')}</div>
        <div className="workspace-select"><span className="workspace-glyph">{t(language, 'workspace').slice(0, 1)}</span><span><strong>{t(language, 'workspace')}</strong><small>{t(language, 'workspaceSub')}</small></span><ChevronRight size={15} /></div>
        <div className="nav-caption">{t(language, 'sections')}</div>
        <nav className="side-nav">
          <button className="side-link active"><FileText size={17} /><span>{t(language, 'requests')}</span>{pendingCount > 0 && <span className="nav-count">{pendingCount}</span>}</button>
          <button className="side-link" onClick={() => setFilter('waiting')}><CalendarDays size={17} /><span>{t(language, 'calendar')}</span><span className="nav-soon">{t(language, 'comingSoon')}</span></button>
          {user.role !== 'employee' && <button className="side-link" onClick={() => setFilter('waiting')}><UsersRound size={17} /><span>{t(language, user.role === 'manager' ? 'myTeam' : 'employees')}</span></button>}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-strip"><div className="help-icon"><ShieldCheck size={18} /></div><div><strong>{t(language, 'controlled')}</strong><small>{t(language, 'everyDecision')}</small></div></div>
          <button className="profile-row" onClick={handleLogout} title={t(language, 'logout')} aria-label={t(language, 'logout')}>
            <span className={`profile-avatar avatar-${user.role}`}>{user.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>
            <span className="profile-info"><strong>{user.name}</strong><small>{t(language, roleTranslationKey[user.role])}</small></span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <main className="main-area" id="top">
        <header className="topbar">
          <div className="breadcrumbs">{t(language, 'cabinet')} <ChevronRight size={14} /> <strong>{t(language, 'requests')}</strong></div>
          <div className="topbar-right"><span className="today-label">{localizedDate(today, language, 'weekday')}</span><AppearanceControls language={language} theme={theme} onLanguageChange={setLanguage} onThemeChange={setTheme} /></div>
        </header>
        <div className="content-wrap">
          <section className="page-heading">
            <div><div className="eyebrow"><span className="eyebrow-line" /> {t(language, user.role === 'employee' ? 'roleEmployee' : user.role === 'manager' ? 'roleManager' : 'roleHr')}</div><h1>{roleHeading}<span className="heading-period">.</span></h1><p>{t(language, user.role === 'employee' ? 'employeeSubtitle' : 'reviewerSubtitle')}</p></div>
            {user.role === 'employee' && <button className="button button-primary create-button" onClick={() => { setError(''); setModal({ type: 'create' }) }}><Plus size={18} /> {t(language, 'newRequest')}</button>}
          </section>

          <section className="stats-row" aria-label={t(language, 'activity')}>
            <div className="stat-block"><span className="stat-label">{t(language, 'totalRequests')}</span><strong>{requests.length.toString().padStart(2, '0')}</strong><span className="stat-foot">{t(language, 'inWorkspace')}</span><FileText className="stat-icon" size={19} /></div>
            <div className="stat-block stat-wait"><span className="stat-label">{t(language, user.role === 'employee' ? 'pendingEmployee' : 'pendingReviewer')}</span><strong>{pendingCount.toString().padStart(2, '0')}</strong><span className="stat-foot">{t(language, pendingCount ? 'waitingLong' : 'allProcessed')}</span><Clock3 className="stat-icon" size={19} /></div>
            <div className="stat-block stat-done"><span className="stat-label">{t(language, 'approvedStat')}</span><strong>{requests.filter((item) => item.status === 'approved').length.toString().padStart(2, '0')}</strong><span className="stat-foot">{t(language, 'canPlan')}</span><CircleCheck className="stat-icon" size={19} /></div>
          </section>

          <section className="requests-section">
            <div className="section-topline"><div><div className="eyebrow eyebrow-muted">{t(language, 'activity')}</div><h2>{t(language, 'requestCount')} <span>{requests.length}</span></h2></div><div className="list-tools"><label className="search-box"><Search size={16} /><input placeholder={t(language, 'search')} value={query} onChange={(event) => setQuery(event.target.value)} /></label></div></div>
            <div className="tabs" role="tablist">{tabs.map((tab) => <button key={tab.key} role="tab" aria-selected={filter === tab.key} className={filter === tab.key ? 'tab selected' : 'tab'} onClick={() => setFilter(tab.key)}>{tab.label}{tab.key === 'waiting' && pendingCount > 0 && <span className="tab-count">{pendingCount}</span>}</button>)}</div>
            <div className="request-list">
              <div className="list-header"><span>{t(language, 'employeeColumn')}</span><span>{t(language, 'periodColumn')}</span><span>{t(language, 'daysColumn')}</span><span>{t(language, 'statusColumn')}</span><span /></div>
              {visibleRequests.map((request) => {
                const canDecide = user.role === 'manager' && request.status === 'manager_pending' || user.role === 'hr' && request.status === 'hr_pending'
                return <article className="request-row" key={request.id}>
                  <div className="request-person"><span className={`request-avatar avatar-${request.employee_id === user.id ? user.role : 'manager'}`}>{request.employee_name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span><strong>{request.employee_id === user.id ? t(language, 'you') : request.employee_name}</strong><small>{t(language, leaveTranslationKey[request.leave_type] ?? 'otherLeave')}</small></span></div>
                  <div className="request-period"><CalendarDays size={15} /><span>{dateLabel(request.start_date, language)} <i>—</i> {dateLabel(request.end_date, language)}</span></div>
                  <div className="request-days"><strong>{request.days}</strong><small>{dayCountLabel(request.days, language)}</small></div>
                  <div><span className={`status-pill status-${request.status}`}><i />{t(language, statusTranslationKey[request.status] ?? 'inProgress')}</span></div>
                  <div className="row-actions">
                    {canDecide ? <><button className="approve-icon" title={t(language, 'approve')} aria-label={t(language, 'approve')} onClick={() => { setError(''); setModal({ type: 'decision', request, decision: 'approve' }) }}><Check size={16} /></button><button className="reject-icon" title={t(language, 'reject')} aria-label={t(language, 'reject')} onClick={() => { setError(''); setModal({ type: 'decision', request, decision: 'reject' }) }}><X size={16} /></button></> : null}
                    <button className="history-link" onClick={() => setModal({ type: 'details', request })}>{t(language, 'details')} <ChevronRight size={15} /></button>
                  </div>
                </article>
              })}
              {visibleRequests.length === 0 && <div className="empty-state"><div className="empty-icon"><FileText size={22} /></div><strong>{requests.length ? t(language, 'noResults') : t(language, 'noRequests')}</strong><p>{requests.length ? t(language, 'searchEmpty') : user.role === 'employee' ? t(language, 'createFirst') : t(language, 'newRequestsHere')}</p>{user.role === 'employee' && !requests.length && <button className="button button-secondary" onClick={() => setModal({ type: 'create' })}><Plus size={16} /> {t(language, 'createRequest')}</button>}</div>}
            </div>
            <div className="list-footer"><span>{t(language, 'showing')} {visibleRequests.length} {t(language, 'of')} {requests.length}</span><span><span className="live-dot" /> {t(language, 'dataUpdated')}</span></div>
          </section>
          <footer className="page-footer"><span>{t(language, 'appName').toUpperCase()}<span className="brand-dot">.</span> {t(language, 'footerLabel')}</span><span>{t(language, 'allDecisionsSaved')}</span></footer>
        </div>
      </main>

      {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null) }}><section className={`modal ${modal.type === 'details' ? 'history-modal' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-top"><div><div className="eyebrow eyebrow-muted">{t(language, modal.type === 'create' ? 'createEyebrow' : modal.type === 'decision' ? 'decisionEyebrow' : 'detailsEyebrow')}</div><h2>{t(language, modal.type === 'create' ? 'planTimeOff' : modal.type === 'decision' ? modal.decision === 'approve' ? 'approveQuestion' : 'rejectQuestion' : 'requestDetails')}</h2></div><button className="icon-button modal-close" title={t(language, 'close')} onClick={() => setModal(null)}><X size={19} /></button></div>
        {modal.type === 'create' && <form className="modal-form" onSubmit={createRequest}>
          <LeaveTypePicker language={language} />
          <DateRangePicker language={language} />
          <label>{t(language, 'comment')} <span className="optional">{t(language, 'optional')}</span><textarea name="note" rows={3} placeholder={t(language, 'notePlaceholder')} /></label>
          <label className="attachment-picker"><span>{t(language, 'attachments')} <span className="optional">{t(language, 'optional')}</span></span><span className="attachment-drop"><Paperclip size={17} /><strong>{t(language, 'addFiles')}</strong><small>{t(language, 'fileLimits')}</small><input ref={attachmentInputRef} type="file" name="attachments" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.doc,.docx" onChange={updateSelectedFiles} /></span>{selectedFiles.length > 0 && <span className="selected-files">{selectedFiles.map((file, index) => <span className="selected-file" key={`${file.name}-${file.size}`}><span>{file.name} · {fileSizeLabel(file.size)}</span><button type="button" title={t(language, 'removeFile')} aria-label={`${t(language, 'removeFile')}: ${file.name}`} onClick={() => removeSelectedFile(index)}><X size={13} /></button></span>)}</span>}</label>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setModal(null)}>{t(language, 'cancel')}</button><button className="button button-primary" disabled={busy}>{busy ? t(language, 'sending') : <>{t(language, 'sendToManager')} <ArrowRight size={16} /></>}</button></div>
        </form>}
        {modal.type === 'decision' && <form className="modal-form" onSubmit={submitDecision}>
          <div className="decision-summary"><div className="summary-icon"><CalendarDays size={18} /></div><div><strong>{modal.request.employee_name}</strong><span>{dateLabel(modal.request.start_date, language)} — {dateLabel(modal.request.end_date, language)} · {modal.request.days} {t(language, 'workingDays')}</span></div></div>
          {modal.request.note && <div className="request-note"><span>{t(language, 'employeeComment')}</span><p>{modal.request.note}</p></div>}
          <label>{modal.decision === 'reject' ? t(language, 'rejectReason') : t(language, 'comment')}{modal.decision === 'reject' && <span className="required-mark"> *</span>}<textarea name="comment" rows={3} required={modal.decision === 'reject'} placeholder={modal.decision === 'reject' ? t(language, 'explainReject') : t(language, 'leaveNote')} /></label>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setModal(null)}>{t(language, 'cancel')}</button><button className={`button ${modal.decision === 'reject' ? 'button-danger' : 'button-primary'}`} disabled={busy}>{busy ? t(language, 'saving') : modal.decision === 'reject' ? t(language, 'reject') : <>{t(language, 'approve')} <Check size={16} /></>}</button></div>
        </form>}
        {modal.type === 'details' && <>
          <div className="history-request-head"><span className={`status-pill status-${modal.request.status}`}><i />{t(language, statusTranslationKey[modal.request.status] ?? 'inProgress')}</span><div className="history-date">{modal.request.employee_name} · {t(language, leaveTranslationKey[modal.request.leave_type] ?? 'otherLeave')} · {dateLabel(modal.request.start_date, language)} — {dateLabel(modal.request.end_date, language)} · {modal.request.days} {t(language, 'workingDays')}</div></div>
          <section className="request-detail-block"><h3>{t(language, 'requestComment')}</h3><p>{modal.request.note || t(language, 'noRequestComment')}</p></section>
          <section className="request-detail-block"><h3>{t(language, 'attachments')} <span>{modal.request.attachments.length}</span></h3>{modal.request.attachments.length === 0 ? <p>{t(language, 'noAttachments')}</p> : <div className="attachment-list">{modal.request.attachments.map((attachment) => <a className="attachment-item" key={attachment.id} href={`/api/requests/${modal.request.id}/attachments/${attachment.id}`} target="_blank" rel="noreferrer"><span className="attachment-file-icon"><FileText size={16} /></span><span><strong>{attachment.original_name}</strong><small>{fileSizeLabel(attachment.size)}</small></span><ArrowDownToLine size={16} /></a>)}</div>}</section>
          <div className="timeline">{modal.request.history.map((entry, index) => <div className="timeline-entry" key={entry.id}><div className={`timeline-marker ${index === modal.request.history.length - 1 ? 'marker-current' : ''}`}>{entry.action === 'rejected' ? <CircleX size={16} /> : ['manager_approved', 'hr_approved'].includes(entry.action) ? <Check size={16} /> : <FileText size={15} />}</div><div className="timeline-content"><div className="timeline-line"><strong>{t(language, historyTranslationKey[entry.action] ?? 'requestHistory')}</strong><time>{new Intl.DateTimeFormat(language === 'kk' ? 'en-GB' : localeByLanguage[language], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(`${entry.created_at.replace(' ', 'T')}Z`))}</time></div><span>{entry.actor_name} · {t(language, roleTranslationKey[entry.actor_role])}</span>{entry.comment && <p>{entry.action === 'submitted' ? t(language, 'submittedToManager') : entry.action === 'manager_approved' && entry.comment === 'Передано на утверждение HR' ? t(language, 'forwardedToHr') : entry.comment}</p>}</div></div>)}</div>
          <div className="modal-actions"><button className="button button-secondary" onClick={() => setModal(null)}>{t(language, 'close')}</button></div>
        </>}
      </section></div>}
    </div>
  )
}

export default App
