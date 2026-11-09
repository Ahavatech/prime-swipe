document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('grid')
  const scoreDisplay = document.getElementById('score')
  const bestPrimeDisplay = document.getElementById('best-prime')
  const goalStatus = document.getElementById('goal-status')
  const statusDisplay = document.getElementById('game-status')
  const notice = document.getElementById('notice')
  const newGameButton = document.getElementById('new-game')
  const rulesDialog = document.getElementById('rules-dialog')
  const openRulesButton = document.getElementById('open-rules')
  const closeRulesButton = document.getElementById('close-rules')
  const leaderboardDialog = document.getElementById('leaderboard-dialog')
  const openLeaderboardButton = document.getElementById('open-leaderboard')
  const closeLeaderboardButton = document.getElementById('close-leaderboard')
  const gameOverDialog = document.getElementById('game-over-dialog')
  const gameOverTitle = document.getElementById('game-over-title')
  const finalScore = document.getElementById('final-score')
  const finalLargestPrime = document.getElementById('final-largest-prime')
  const finalMoves = document.getElementById('final-moves')
  const finalDuration = document.getElementById('final-duration')
  const finalBest = document.getElementById('final-best')
  const scoreForm = document.getElementById('score-form')
  const displayName = document.getElementById('display-name')
  const nameError = document.getElementById('name-error')
  const submitButton = document.getElementById('submit-score')
  const submissionStatus = document.getElementById('submission-status')
  const restartAfterSubmitButton = document.getElementById('restart-after-submit')
  const playAgainButton = document.getElementById('play-again')
  const closeSummaryButton = document.getElementById('close-summary')
  const loadLeaderboardButton = document.getElementById('load-leaderboard')
  const leaderboardStatus = document.getElementById('leaderboard-status')
  const sortLargestPrimeButton = document.getElementById('sort-largest-prime')
  const largestPrimeHeading = document.getElementById('largest-prime-heading')
  const leaderboardTableWrap = document.getElementById('leaderboard-table-wrap')
  const leaderboardEntries = document.getElementById('leaderboard-entries')
  const cells = []
  const numberFormat = new Intl.NumberFormat()
  let state = GameEngine.createGame()
  let session = null
  let moveCount = 0
  let runStarting = false
  let gameStartSequence = 0
  let startedAt = Date.now()
  let touchStart = null
  let bestPrime = 0
  let storageAvailable = true
  let pendingSubmission = null
  let submissionInFlight = false
  let submissionConfirmed = false
  let persistentNotice = ''
  let leaderboardLoadSequence = 0
  let leaderboardSortBy = 'score'

  function showNotice(message) {
    notice.textContent = message
    notice.hidden = false
  }

  try {
    const stored = globalThis.localStorage.getItem('prime-swipe-best-prime')
    if (stored !== null) {
      const parsed = Number(stored)
      if (Number.isSafeInteger(parsed) && parsed >= 0 && (parsed === 0 || GameEngine.isPrime(parsed))) {
        bestPrime = parsed
      }
    }
  } catch {
    storageAvailable = false
    statusDisplay.textContent = 'Local storage is unavailable. Your Best will last only for this visit.'
    persistentNotice = 'Local storage is unavailable, so your best prime will last only for this visit.'
    showNotice(persistentNotice)
  }

  for (let rowIndex = 0; rowIndex < 4; rowIndex += 1) {
    const row = document.createElement('div')
    row.className = 'grid-row'
    row.setAttribute('role', 'row')
    row.setAttribute('aria-rowindex', String(rowIndex + 1))

    for (let columnIndex = 0; columnIndex < 4; columnIndex += 1) {
      const cell = document.createElement('div')
      cell.className = 'tile'
      cell.setAttribute('role', 'gridcell')
      cell.setAttribute('aria-colindex', String(columnIndex + 1))
      row.appendChild(cell)
      cells.push(cell)
    }
    grid.appendChild(row)
  }

  function formatNumber(value) {
    return numberFormat.format(value)
  }

  function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60)
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
  }

  function currentDuration() {
    return Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  }

  function modalOpen() {
    return Boolean(document.querySelector('dialog[open]'))
  }

  // Odd tiles darken as they grow; this keeps going past 101.
  function tierFor(value) {
    if (value < 5) return 0
    if (value < 13) return 1
    if (value < 31) return 2
    if (value < 67) return 3
    return 4
  }

  function equationText(merge) {
    return `${formatNumber(merge.from[0])} + ${formatNumber(merge.from[1])}`
  }

  function render(merges = []) {
    const mergeByIndex = new Map(merges.map(merge => [merge.index, merge]))

    scoreDisplay.textContent = formatNumber(state.score)
    bestPrimeDisplay.textContent = formatNumber(bestPrime)
    goalStatus.textContent = state.goalAchieved ? 'Reached' : 'Not yet'
    goalStatus.classList.toggle('is-achieved', state.goalAchieved)

    state.board.forEach((value, index) => {
      const cell = cells[index]
      const position = `Row ${Math.floor(index / 4) + 1}, column ${(index % 4) + 1}`
      const merge = mergeByIndex.get(index)

      cell.classList.remove('just-merged')
      cell.dataset.value = String(value)
      if (value === 0) {
        delete cell.dataset.parity
        delete cell.dataset.tier
        cell.textContent = ''
        cell.setAttribute('aria-label', `${position}: empty`)
        return
      }

      const isOdd = value % 2 === 1
      cell.dataset.parity = isOdd ? 'odd' : 'even'
      if (isOdd) {
        cell.dataset.tier = String(tierFor(value))
      } else {
        delete cell.dataset.tier
      }
      cell.textContent = formatNumber(value)

      const labelParts = [`${position}: ${value}`, isOdd ? 'odd' : 'even']
      if (GameEngine.isPrime(value)) {
        labelParts.push('prime tile')
      }
      if (merge) {
        labelParts.push(`built from ${merge.from[0]} plus ${merge.from[1]}`)
        const equation = document.createElement('span')
        equation.className = 'tile-eq'
        equation.setAttribute('aria-hidden', 'true')
        equation.textContent = equationText(merge)
        cell.appendChild(equation)
      }
      cell.setAttribute('aria-label', labelParts.join(', '))
    })

    // Force a reflow so the merge animation replays when the same cell merges on back-to-back swipes.
    void grid.offsetWidth
    mergeByIndex.forEach((merge, index) => cells[index].classList.add('just-merged'))
  }

  function saveBestPrime() {
    if (state.largestPrime <= bestPrime) {
      return
    }
    bestPrime = state.largestPrime
    bestPrimeDisplay.textContent = formatNumber(bestPrime)
    if (!storageAvailable) {
      return
    }
    try {
      globalThis.localStorage.setItem('prime-swipe-best-prime', String(bestPrime))
    } catch {
      storageAvailable = false
      statusDisplay.textContent = 'Your Best improved, but local storage is unavailable. It will last only for this visit.'
      showNotice('Local storage is unavailable, so your best prime will last only for this visit.')
    }
  }

  function announceMove(direction, outcome) {
    const label = direction[0].toUpperCase() + direction.slice(1)
    if (outcome.merges.length) {
      const sums = outcome.merges
        .map(merge => `${formatNumber(merge.from[0])} + ${formatNumber(merge.from[1])} = ${formatNumber(merge.sum)}`)
        .join(', ')
      statusDisplay.textContent = `${label}. ${sums}. Score +${formatNumber(outcome.scoreDelta)}. One new tile spawned.`
    } else {
      statusDisplay.textContent = `${label}. Tiles moved; no prime sums formed. One new tile spawned.`
    }
  }

  function gameSummary() {
    finalScore.textContent = formatNumber(state.score)
    finalLargestPrime.textContent = formatNumber(state.largestPrime)
    finalMoves.textContent = formatNumber(moveCount)
    finalDuration.textContent = formatDuration(currentDuration())
    finalBest.textContent = formatNumber(bestPrime)
  }

  function showGameOver() {
    gameSummary()
    const ranked = Boolean(session?.ranked)
    submissionStatus.textContent = ranked ? '' : 'Practice game, scores cannot be submitted.'
    scoreForm.hidden = !ranked
    submitButton.hidden = false
    submitButton.disabled = !ranked
    restartAfterSubmitButton.hidden = true
    nameError.hidden = true
    if (!gameOverDialog.open) {
      gameOverDialog.showModal()
      gameOverTitle.focus()
    }
  }

  function resetSubmission() {
    pendingSubmission = null
    submissionInFlight = false
    submissionConfirmed = false
    submitButton.disabled = false
    submitButton.textContent = 'Check rank & submit'
    displayName.disabled = false
    displayName.value = ''
    submitButton.hidden = false
    restartAfterSubmitButton.hidden = true
    scoreForm.hidden = false
  }

  function newGame({ focus = true } = {}) {
    const sequence = ++gameStartSequence
    runStarting = true
    session = null
    state = GameEngine.createGame()
    moveCount = 0
    startedAt = Date.now()
    resetSubmission()
    submitButton.disabled = true
    submissionStatus.textContent = 'Starting ranked run…'
    showNotice('Starting ranked run…')
    if (gameOverDialog.open) {
      gameOverDialog.close()
    }
    render()
    statusDisplay.textContent = 'Starting ranked run…'
    if (focus) {
      grid.focus()
    }

    return LeaderboardAPI.startRun().then(run => {
      if (sequence !== gameStartSequence) {
        return
      }
      if (run.engineVersion !== GameEngine.VERSION) {
        const error = new Error('The game rules do not match the server. Refresh the page before starting a new run.')
        error.code = 'ENGINE_VERSION_MISMATCH'
        throw error
      }
      session = RunSession.createRunSession({ engine: GameEngine, claims: run })
      state = session.snapshot().state
      runStarting = false
      submitButton.disabled = false
      submissionStatus.textContent = ''
      render()
      if (persistentNotice) {
        notice.textContent = persistentNotice
        notice.hidden = false
      } else {
        notice.hidden = true
      }
      statusDisplay.textContent = storageAvailable
        ? 'New game. Start with one odd tile and one even tile.'
        : 'New game. Local storage is unavailable, so Best lasts only for this visit.'
    }).catch(error => {
      if (sequence !== gameStartSequence) {
        return
      }
      runStarting = false
      session = RunSession.createRunSession({ engine: GameEngine, claims: null })
      state = session.snapshot().state
      submitButton.disabled = true
      scoreForm.hidden = true
      submissionStatus.textContent = 'Practice game, scores cannot be submitted.'
      showNotice('Practice game, scores cannot be submitted.')
      render()
      statusDisplay.textContent = 'Practice game, scores cannot be submitted.'
    })
  }

  function move(direction) {
    if (!session || state.status !== 'playing' || modalOpen() || runStarting) {
      return
    }
    const outcome = session.move(direction)
    if (!outcome.moved) {
      statusDisplay.textContent = 'No tiles moved. No new tile spawned.'
      return
    }
    state = outcome.state
    moveCount += 1
    saveBestPrime()
    render(outcome.merges)
    announceMove(direction, outcome)
    if (state.status === 'game-over') {
      statusDisplay.textContent = `${statusDisplay.textContent} Game over. The board is full with no legal prime-sum merge.`
      showGameOver()
    }
  }

  function directionForKey(key) {
    return ({
      ArrowLeft: 'left',
      a: 'left',
      A: 'left',
      ArrowRight: 'right',
      d: 'right',
      D: 'right',
      ArrowUp: 'up',
      w: 'up',
      W: 'up',
      ArrowDown: 'down',
      s: 'down',
      S: 'down'
    })[key]
  }

  function handleKeyDown(event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || modalOpen()) {
      return
    }
    const target = event.target
    if (target?.closest?.('button, input, textarea, select, summary, a, [contenteditable="true"]')) {
      return
    }
    const direction = directionForKey(event.key)
    if (!direction) {
      return
    }
    event.preventDefault()
    move(direction)
  }

  function handlePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) {
      return
    }
    touchStart = { x: event.clientX, y: event.clientY }
    if (grid.setPointerCapture && event.pointerId !== undefined) {
      grid.setPointerCapture(event.pointerId)
    }
  }

  function handlePointerUp(event) {
    if (!touchStart) {
      return
    }
    const deltaX = event.clientX - touchStart.x
    const deltaY = event.clientY - touchStart.y
    touchStart = null
    const threshold = 26
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < threshold) {
      return
    }
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      move(deltaX < 0 ? 'left' : 'right')
    } else {
      move(deltaY < 0 ? 'up' : 'down')
    }
  }

  function clearPointer() {
    touchStart = null
  }

  function setNameError(message) {
    nameError.textContent = message
    nameError.hidden = false
    displayName.setAttribute('aria-invalid', 'true')
    displayName.focus()
  }

  function clearNameError() {
    nameError.textContent = ''
    nameError.hidden = true
    displayName.removeAttribute('aria-invalid')
  }

  function showTerminalSubmissionError(error) {
    submissionStatus.textContent = error.message
    scoreForm.hidden = true
    submitButton.hidden = true
    restartAfterSubmitButton.hidden = false
  }

  function showExpiredRun() {
    showTerminalSubmissionError({
      message: 'This run has expired. Start a new game before submitting.'
    })
  }

  async function sendPendingSubmission() {
    if (!pendingSubmission || submissionInFlight || submissionConfirmed) {
      return
    }
    if (session?.isExpired(Date.now())) {
      showExpiredRun()
      return
    }
    const sequence = gameStartSequence
    const payload = pendingSubmission
    submissionInFlight = true
    submitButton.disabled = true
    submitButton.textContent = 'Waiting for confirmation…'
    submissionStatus.textContent = 'Sending your run. It is not recorded until the API confirms it.'
    try {
      const result = await LeaderboardAPI.submitScore(payload)
      if (sequence !== gameStartSequence) {
        return
      }
      if (
        result.source !== 'backend' ||
        result.displayName !== payload.displayName ||
        result.moves !== payload.moveLog.length
      ) {
        throw new Error('The server response did not confirm this run.')
      }
      submissionConfirmed = true
      submitButton.textContent = 'Score confirmed'
      submissionStatus.textContent = `Score confirmed by the server. Score ${formatNumber(result.score)}, largest prime ${formatNumber(result.largestPrime)}, ${formatNumber(result.moves)} moves, rank ${result.rank}.`
    } catch (error) {
      if (sequence !== gameStartSequence) {
        return
      }
      const terminalRunErrors = new Set([
        'INVALID_RUN_TOKEN',
        'RUN_ALREADY_SUBMITTED',
        'ENGINE_VERSION_MISMATCH',
        'RUN_EXPIRED',
        'RUN_REJECTED',
        'SCORE_MISMATCH',
        'NOTHING_TO_RANK'
      ])
      const cannotRetry = terminalRunErrors.has(error.code)
      if (cannotRetry) {
        showTerminalSubmissionError(error)
      } else {
        submissionStatus.textContent = `${error.message || 'The leaderboard did not confirm this run.'} You can retry this same run.`
        submitButton.disabled = false
        submitButton.textContent = 'Retry submission'
      }
    } finally {
      if (sequence === gameStartSequence) {
        submissionInFlight = false
      }
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (submissionInFlight || submissionConfirmed) {
      return
    }
    if (!session?.ranked) {
      submissionStatus.textContent = 'Practice game, scores cannot be submitted.'
      return
    }
    if (session.isExpired(Date.now())) {
      showExpiredRun()
      return
    }
    clearNameError()
    if (pendingSubmission) {
      await sendPendingSubmission()
      return
    }
    const sequence = gameStartSequence
    const submissionSession = session
    const snapshot = submissionSession.snapshot()
    const normalizedName = displayName.value.normalize('NFC').trim()
    if (!/^[A-Za-z0-9 _-]{1,12}$/.test(normalizedName)) {
      setNameError('Enter 1–12 letters, numbers, spaces, hyphens, or underscores.')
      return
    }

    submissionInFlight = true
    submitButton.disabled = true
    submitButton.textContent = 'Checking rank…'
    submissionStatus.textContent = 'Checking whether this score qualifies. No name or run has been submitted yet.'
    try {
      const rank = await LeaderboardAPI.getProjectedRank({ score: snapshot.state.score })
      if (sequence !== gameStartSequence || session !== submissionSession) {
        return
      }
      if (rank.source !== 'backend') {
        throw new Error('A verified backend rank is unavailable.')
      }
      if (!rank.qualifies) {
        submissionStatus.textContent = `This Score does not currently qualify for the public top ${rank.leaderboardLimit}; the run was not submitted.`
        return
      }
      pendingSubmission = {
        displayName: normalizedName,
        runToken: snapshot.runToken,
        moveLog: snapshot.moveLog,
        score: snapshot.state.score
      }
      Object.freeze(pendingSubmission)
      displayName.disabled = true
      submissionInFlight = false
      await sendPendingSubmission()
    } catch (error) {
      if (sequence !== gameStartSequence) {
        return
      }
      submissionStatus.textContent = `Rank could not be verified (${error.message}). Nothing was confirmed or submitted. Check the connection and try again.`
    } finally {
      if (sequence === gameStartSequence && (!pendingSubmission || submissionConfirmed)) {
        submissionInFlight = false
        submitButton.disabled = submissionConfirmed
        if (!submissionConfirmed) {
          submitButton.textContent = 'Check rank & submit'
        }
      }
    }
  }

  function showLeaderboardError(error) {
    leaderboardTableWrap.hidden = true
    leaderboardStatus.textContent = `Leaderboard unavailable (${error.message}). You can retry; your game is unaffected.`
  }

  async function loadLeaderboard() {
    const sequence = ++leaderboardLoadSequence
    const sortBy = leaderboardSortBy
    loadLeaderboardButton.disabled = true
    leaderboardTableWrap.hidden = true
    leaderboardStatus.textContent = 'Loading leaderboard entries…'
    try {
      const result = await LeaderboardAPI.getLeaderboard({ sortBy })
      if (sequence !== leaderboardLoadSequence) {
        return
      }
      if (result.source !== 'backend') {
        throw new Error('A leaderboard response is unavailable.')
      }
      leaderboardEntries.replaceChildren()
      if (result.entries.length === 0) {
        leaderboardStatus.textContent = 'No runs have been submitted yet.'
        return
      }
      result.entries.forEach((entry, index) => {
        const row = document.createElement('tr')
        for (const value of [formatNumber(index + 1), entry.displayName, formatNumber(entry.score), formatNumber(entry.largestPrime)]) {
          const cell = document.createElement('td')
          cell.textContent = value
          row.appendChild(cell)
        }
        if (entry.largestPrime > 101) {
          row.children[3].classList.add('largest-prime-record')
        }
        if (!entry.verified) {
          const label = document.createElement('span')
          label.className = 'unverified-label'
          label.textContent = 'unverified'
          row.children[1].appendChild(label)
        }
        leaderboardEntries.appendChild(row)
      })
      leaderboardTableWrap.hidden = false
      const sortLabel = sortBy === 'score'
        ? 'Score'
        : `largest prime ${sortBy === 'largestPrime' ? 'descending' : 'ascending'}`
      leaderboardStatus.textContent = `Showing ${result.entries.length} runs sorted by ${sortLabel}.`
    } catch (error) {
      if (sequence === leaderboardLoadSequence) {
        showLeaderboardError(error)
      }
    } finally {
      if (sequence === leaderboardLoadSequence) {
        loadLeaderboardButton.disabled = false
      }
    }
  }

  function cycleLargestPrimeSort() {
    leaderboardSortBy = leaderboardSortBy === 'score'
      ? 'largestPrime'
      : leaderboardSortBy === 'largestPrime'
        ? 'largestPrimeAsc'
        : 'score'
    const isPrimeSorted = leaderboardSortBy !== 'score'
    sortLargestPrimeButton.classList.toggle('is-descending', leaderboardSortBy === 'largestPrime')
    sortLargestPrimeButton.classList.toggle('is-ascending', leaderboardSortBy === 'largestPrimeAsc')
    sortLargestPrimeButton.setAttribute('aria-pressed', String(isPrimeSorted))
    sortLargestPrimeButton.setAttribute(
      'aria-label',
      leaderboardSortBy === 'score'
        ? 'Sort by largest prime'
        : `Sort by largest prime ${leaderboardSortBy === 'largestPrime' ? 'descending' : 'ascending'}`
    )
    largestPrimeHeading.setAttribute(
      'aria-sort',
      leaderboardSortBy === 'score'
        ? 'none'
        : leaderboardSortBy === 'largestPrime'
          ? 'descending'
          : 'ascending'
    )
    loadLeaderboard()
  }

  function openLeaderboard() {
    if (!leaderboardDialog.open) {
      leaderboardDialog.showModal()
    }
    loadLeaderboard()
  }

  newGameButton.addEventListener('click', newGame)
  playAgainButton.addEventListener('click', newGame)
  restartAfterSubmitButton.addEventListener('click', newGame)
  closeSummaryButton.addEventListener('click', () => gameOverDialog.close())
  openRulesButton.addEventListener('click', () => rulesDialog.showModal())
  closeRulesButton.addEventListener('click', () => rulesDialog.close())
  openLeaderboardButton.addEventListener('click', openLeaderboard)
  sortLargestPrimeButton.addEventListener('click', cycleLargestPrimeSort)
  closeLeaderboardButton.addEventListener('click', () => leaderboardDialog.close())
  gameOverDialog.addEventListener('close', () => {
    if (state.status === 'game-over') {
      grid.focus()
      statusDisplay.textContent = 'Game over. Choose New game to play again.'
    }
  })
  scoreForm.addEventListener('submit', handleSubmit)
  displayName.addEventListener('input', clearNameError)
  loadLeaderboardButton.addEventListener('click', loadLeaderboard)
  document.addEventListener('keydown', handleKeyDown)
  grid.addEventListener('pointerdown', handlePointerDown)
  grid.addEventListener('pointerup', handlePointerUp)
  grid.addEventListener('pointercancel', clearPointer)
  grid.addEventListener('lostpointercapture', clearPointer)

  return newGame({ focus: false })
})
