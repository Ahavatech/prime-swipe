document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('grid')
  const scoreDisplay = document.getElementById('score')
  const bestPrimeDisplay = document.getElementById('best-prime')
  const goalStatus = document.getElementById('goal-status')
  const goalNote = document.getElementById('goal-note')
  const statusDisplay = document.getElementById('game-status')
  const newGameButton = document.getElementById('new-game')
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
  const playAgainButton = document.getElementById('play-again')
  const closeSummaryButton = document.getElementById('close-summary')
  const loadLeaderboardButton = document.getElementById('load-leaderboard')
  const leaderboardStatus = document.getElementById('leaderboard-status')
  const leaderboardTableWrap = document.getElementById('leaderboard-table-wrap')
  const leaderboardEntries = document.getElementById('leaderboard-entries')
  const cells = []
  const numberFormat = new Intl.NumberFormat()
  let state = GameEngine.createGame()
  let moveCount = 0
  let startedAt = Date.now()
  let touchStart = null
  let bestPrime = 0
  let storageAvailable = true
  let pendingSubmission = null
  let submissionInFlight = false
  let submissionConfirmed = false
  let submissionSequence = 0

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

  function render(mergedIndices = []) {
    scoreDisplay.textContent = formatNumber(state.score)
    bestPrimeDisplay.textContent = formatNumber(bestPrime)
    goalStatus.textContent = state.goalAchieved ? 'Reached — keep playing' : 'Not reached'
    goalStatus.classList.toggle('is-achieved', state.goalAchieved)
    goalNote.textContent = state.goalAchieved
      ? '101 reached. The run continues; keep building.'
      : '101 is a milestone, not an ending. Your run continues.'

    state.board.forEach((value, index) => {
      const cell = cells[index]
      const isPrime = value > 0 && GameEngine.isPrime(value)
      cell.dataset.value = String(value)
      cell.textContent = value === 0 ? '' : formatNumber(value)
      cell.setAttribute(
        'aria-label',
        value === 0
          ? `Row ${Math.floor(index / 4) + 1}, column ${(index % 4) + 1}: empty`
          : `Row ${Math.floor(index / 4) + 1}, column ${(index % 4) + 1}: ${value}${isPrime ? ', prime tile' : ''}`
      )
      cell.classList.toggle('just-merged', mergedIndices.includes(index))
    })
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
    }
  }

  function runId() {
    submissionSequence += 1
    const uuid = globalThis.crypto?.randomUUID?.()
    return `prime-swipe-${uuid || `${Date.now()}-${submissionSequence}-${Math.random().toString(36).slice(2)}`}`
  }

  function announceMove(direction, outcome) {
    const label = direction[0].toUpperCase() + direction.slice(1)
    if (outcome.mergedValues.length) {
      const merged = outcome.mergedValues.map(formatNumber).join(' and ')
      statusDisplay.textContent = `${label}. Built prime tile${outcome.mergedValues.length === 1 ? '' : 's'} ${merged}. Score +${formatNumber(outcome.scoreDelta)}. One new tile spawned.`
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
    submissionStatus.textContent = ''
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
  }

  function newGame() {
    state = GameEngine.createGame()
    moveCount = 0
    startedAt = Date.now()
    resetSubmission()
    submissionStatus.textContent = ''
    if (gameOverDialog.open) {
      gameOverDialog.close()
    }
    render()
    statusDisplay.textContent = storageAvailable
      ? 'New game. Start with one odd tile and one even tile.'
      : 'New game. Local storage is unavailable, so Best lasts only for this visit.'
    grid.focus()
  }

  function move(direction) {
    if (state.status !== 'playing' || gameOverDialog.open) {
      return
    }
    const outcome = GameEngine.move(state, direction)
    if (!outcome.moved) {
      statusDisplay.textContent = 'No tiles moved. No new tile spawned.'
      return
    }
    state = outcome.state
    moveCount += 1
    saveBestPrime()
    render(outcome.mergedIndices)
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
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || gameOverDialog.open) {
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

  async function sendPendingSubmission() {
    if (!pendingSubmission || submissionInFlight || submissionConfirmed) {
      return
    }
    submissionInFlight = true
    submitButton.disabled = true
    submitButton.textContent = 'Waiting for confirmation…'
    submissionStatus.textContent = 'Sending your run. It is not recorded until the API confirms it.'
    try {
      const result = await LeaderboardAPI.submitScore(pendingSubmission)
      if (
        result.source !== 'backend' ||
        result.displayName !== pendingSubmission.displayName ||
        result.score !== pendingSubmission.score ||
        result.largestPrime !== pendingSubmission.largestPrime
      ) {
        throw new Error('The server response did not confirm this run.')
      }
      submissionConfirmed = true
      submitButton.textContent = 'Score confirmed'
      submissionStatus.textContent = `Score confirmed by the server. Score ${formatNumber(result.score)}, largest prime ${formatNumber(result.largestPrime)}, rank ${result.rank}.`
    } catch (error) {
      submissionStatus.textContent = `The leaderboard did not confirm this run (${error.message}). Retry to safely check the same run again; its submission key prevents duplicates.`
      submitButton.disabled = false
      submitButton.textContent = 'Retry submission'
    } finally {
      submissionInFlight = false
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (submissionInFlight || submissionConfirmed) {
      return
    }
    clearNameError()
    if (pendingSubmission) {
      await sendPendingSubmission()
      return
    }
    const normalizedName = displayName.value.normalize('NFC').trim()
    if (!/^[A-Za-z0-9 _-]{1,12}$/.test(normalizedName)) {
      setNameError('Enter 1–12 letters, numbers, spaces, hyphens, or underscores.')
      return
    }

    submissionInFlight = true
    submitButton.disabled = true
    submitButton.textContent = 'Checking rank…'
    submissionStatus.textContent = 'Checking whether this cumulative Score qualifies. No name or run has been submitted yet.'
    try {
      const rank = await LeaderboardAPI.getProjectedRank({ score: state.score })
      if (rank.source !== 'backend') {
        throw new LeaderboardAPI.LeaderboardApiError('A verified backend rank is unavailable.', 'INVALID_RESPONSE')
      }
      if (!rank.qualifies) {
        submissionStatus.textContent = `This Score does not currently qualify for the public top ${rank.leaderboardLimit}; the run was not submitted.`
        return
      }
      pendingSubmission = {
        submissionId: runId(),
        displayName: normalizedName,
        score: state.score,
        largestPrime: state.largestPrime,
        moves: moveCount,
        durationSeconds: currentDuration()
      }
      displayName.disabled = true
      submissionInFlight = false
      await sendPendingSubmission()
    } catch (error) {
      submissionStatus.textContent = `Rank could not be verified (${error.message}). Nothing was confirmed or submitted. Check the connection and try again.`
    } finally {
      if (!pendingSubmission || submissionConfirmed) {
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
    loadLeaderboardButton.disabled = true
    leaderboardTableWrap.hidden = true
    leaderboardStatus.textContent = 'Loading verified leaderboard entries…'
    try {
      const result = await LeaderboardAPI.getLeaderboard()
      if (result.source !== 'backend') {
        throw new Error('A verified leaderboard response is unavailable.')
      }
      leaderboardEntries.replaceChildren()
      if (result.entries.length === 0) {
        leaderboardStatus.textContent = 'No runs have been submitted yet.'
        return
      }
      result.entries.forEach(entry => {
        const row = document.createElement('tr')
        for (const value of [
          formatNumber(entry.rank),
          entry.displayName,
          formatNumber(entry.score),
          formatNumber(entry.largestPrime)
        ]) {
          const cell = document.createElement('td')
          cell.textContent = value
          row.appendChild(cell)
        }
        leaderboardEntries.appendChild(row)
      })
      leaderboardTableWrap.hidden = false
      leaderboardStatus.textContent = `Showing ${result.entries.length} server-ranked runs. Score and largest prime are separate values.`
    } catch (error) {
      showLeaderboardError(error)
    } finally {
      loadLeaderboardButton.disabled = false
    }
  }

  newGameButton.addEventListener('click', newGame)
  playAgainButton.addEventListener('click', newGame)
  closeSummaryButton.addEventListener('click', () => gameOverDialog.close())
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

  render()
  if (statusDisplay.textContent === '') {
    statusDisplay.textContent = 'New game. Start with one odd tile and one even tile.'
  }
})
