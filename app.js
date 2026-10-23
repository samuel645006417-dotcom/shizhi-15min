'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const library = window.SHIZHI_LIBRARY;
  if (!Array.isArray(library?.cards) || !library.cards.length || !Array.isArray(library.categories) || !library.categories.length) {
    $('content-warning').hidden = false;
    $('draw-first').disabled = true;
    return;
  }
  const { cards, categories } = library;
  const articles = window.SHIZHI_ARTICLES;
  const byId = new Map(cards.map(card => [card.id, card]));
  const categoryMap = new Map(categories.map(category => [category.id, category]));
  const KEY = 'shizhi.completed.v1';
  if (!articles || cards.some(card => !articles[card.id]?.theory?.length || !articles[card.id]?.practice?.length)) {
    $('content-warning').hidden = false;
    $('draw-first').disabled = true;
    return;
  }
  let completed = new Set();
  let storageOK = true;
  let current = null;
  let bag = [];
  let cardView = 'theory';
  let toastTimeout;
  let remainingMs = 15 * 60 * 1000;
  let deadline = null;
  let timerInterval = null;
  let finished = false;

  function readCompleted() {
    try {
      const raw = localStorage.getItem(KEY);
      const stored = raw === null ? [] : JSON.parse(raw);
      if (!Array.isArray(stored)) throw new Error('Invalid completion data');
      return new Set(stored.filter(id => typeof id === 'string' && byId.has(id)));
    } catch (_) {
      storageOK = false;
      return new Set();
    }
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify([...completed]));
      storageOK = true;
    } catch (_) {
      storageOK = false;
    }
    $('storage-warning').hidden = storageOK;
  }

  function notify(message) {
    clearTimeout(toastTimeout);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimeout = setTimeout(() => { $('toast').hidden = true; }, 3500);
  }

  // Fisher-Yates over question IDs gives every uncompleted question equal weight.
  function shuffle(ids) {
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids;
  }

  function updateCounts() {
    $('remaining').textContent = `题库 ${cards.length} 题 · 还可探索 ${cards.length - completed.size} 题`;
    $('completed-count').textContent = `当前浏览器已记住 ${completed.size} 个完成题号。`;
    $('reset-open').disabled = completed.size === 0;
    for (const category of categories) {
      const total = cards.filter(c => c.category === category.id).length;
      const done = cards.filter(c => c.category === category.id && completed.has(c.id)).length;
      $(`count-${category.id}`).textContent = `${total - done} / ${total} 题未完成`;
    }
  }

  function stopTicker() {
    if (timerInterval !== null) clearInterval(timerInterval);
    timerInterval = null;
  }

  function timerText() {
    const seconds = Math.ceil(Math.max(0, remainingMs) / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function renderTimer() {
    $('timer-display').textContent = timerText();
    const seconds = Math.ceil(Math.max(0, remainingMs) / 1000);
    $('timer-display').setAttribute('aria-label', `剩余 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`);
    const elapsed = Math.min(900, Math.max(0, (900000 - remainingMs) / 1000));
    $('timer-fill').style.width = `${elapsed / 9}%`;
    $('timer-progress').setAttribute('aria-valuenow', String(Math.floor(elapsed)));
  }

  function resetTimer() {
    stopTicker();
    deadline = null;
    remainingMs = 900000;
    finished = false;
    const available = !!current && !completed.has(current.id);
    $('timer-toggle').disabled = !available;
    $('timer-reset').disabled = !available;
    $('timer-toggle').textContent = '开始 15 分钟';
    $('timer-status').textContent = available ? '准备就绪' : '抽题后开始';
    $('timer-hint').textContent = available ? '阅读和记笔记共留 15 分钟，可随时暂停。' : '先抽一个知识点，再开始计时。';
    renderTimer();
  }

  function tick() {
    if (deadline === null) return;
    remainingMs = Math.max(0, deadline - Date.now());
    if (remainingMs === 0) {
      stopTicker();
      deadline = null;
      finished = true;
      $('timer-status').textContent = '一刻钟到了';
      $('timer-toggle').textContent = '再计 15 分钟';
      $('timer-hint').textContent = '回想一下：它是什么？有什么依据？我能怎样应用？';
      notify('15 分钟到了，留一点时间归纳。');
    }
    renderTimer();
  }

  function toggleTimer() {
    if (!current || completed.has(current.id)) return;
    if (deadline !== null) {
      tick();
      // tick may have finished the timer while the page was in the background.
      if (finished) return;
      deadline = null;
      stopTicker();
      $('timer-status').textContent = '已暂停';
      $('timer-toggle').textContent = '继续计时';
      return;
    }
    if (finished) resetTimer();
    deadline = Date.now() + remainingMs;
    $('timer-status').textContent = '正在计时';
    $('timer-toggle').textContent = '暂停计时';
    timerInterval = setInterval(tick, 250);
    tick();
  }

  function renderCurrent() {
    const category = categoryMap.get(current.category);
    $('welcome').hidden = true;
    $('empty').hidden = true;
    $('active-card').hidden = false;
    document.querySelector('.question-panel').setAttribute('aria-labelledby', 'topic-title');
    $('card-category').textContent = category.name;
    $('topic-title').textContent = current.title;
    $('topic-question').textContent = current.question;
    cardView = 'theory';
    renderArticle(articles[current.id]);
    renderCompletion();
  }

  function renderArticle(article) {
    const sections = article[cardView].map(section => {
      const node = document.createElement('section');
      const heading = document.createElement('h3');
      heading.textContent = section.heading;
      node.append(heading);
      for (const text of section.paragraphs) {
        const paragraph = document.createElement('p');
        paragraph.textContent = text;
        node.append(paragraph);
      }
      return node;
    });
    $('article-content').replaceChildren(...sections);
    $('article-length').textContent = '双卡原创讲解 · 理论与实践';
    const isTheory = cardView === 'theory';
    $('reading-card-title').textContent = isTheory ? '理论点' : '应用实践';
    $('reading-card-position').textContent = isTheory ? '1 / 2' : '2 / 2';
    $('view-theory').setAttribute('aria-pressed', String(isTheory));
    $('view-practice').setAttribute('aria-pressed', String(!isTheory));
    $('card-switch').textContent = isTheory ? '看应用实践 →' : '← 返回理论点';
    $('article-reflection').hidden = isTheory;
    $('takeaway-text').textContent = article.takeaway;
    $('article-reflection-text').textContent = article.reflection;
    $('article-sources').replaceChildren(...article.sources.map(source => {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.textContent = source.title;
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const note = document.createElement('p');
      note.textContent = source.note;
      li.append(link, note);
      return li;
    }));
    document.querySelector('.article-sources').open = false;
  }

  function setCardView(view) {
    if (!current || cardView === view) return;
    cardView = view;
    renderArticle(articles[current.id]);
    $('reading-card-title').focus({ preventScroll: true });
    $('reading-card').scrollIntoView({ block: 'start', behavior: 'instant' });
  }

  function renderCompletion() {
    const done = !!current && completed.has(current.id);
    $('complete').disabled = done;
    $('complete').textContent = done ? '已完成，本题以后会避开' : '标记已完成';
    $('card-state').textContent = done ? '已完成' : '本次学习';
    $('card-state').classList.toggle('completed-label', done);
    $('draw-next').textContent = done ? '再抽一个 ↗' : '换一题 ↻';
    $('undo').hidden = !done;
  }

  function draw() {
    const available = cards.filter(card => !completed.has(card.id));
    bag = bag.filter(id => !completed.has(id));
    if (available.length === 0) {
      current = null;
      resetTimer();
      $('welcome').hidden = true;
      $('active-card').hidden = true;
      $('empty').hidden = false;
      document.querySelector('.question-panel').setAttribute('aria-label', '本轮题库已完成');
      document.querySelector('.question-panel').removeAttribute('aria-labelledby');
      $('timer-status').textContent = '本轮已完成';
      return;
    }
    if (bag.length === 0) {
      bag = shuffle(available.map(card => card.id));
      // Avoid drawing the same card immediately at a shuffle boundary.
      if (bag.length > 1 && bag[bag.length - 1] === current?.id) {
        [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
      }
    }
    const previous = current?.id;
    current = byId.get(bag.pop());
    renderCurrent();
    resetTimer();
    $('topic-title').focus({ preventScroll: true });
    document.querySelector('.question-panel').scrollIntoView({ block: 'start' });
    if (previous === current.id && available.length === 1) notify('只剩这一个未完成问题了。');
  }

  function complete() {
    if (!current || completed.has(current.id)) return;
    completed.add(current.id);
    persist();
    updateCounts();
    resetTimer();
    $('timer-status').textContent = '本题已完成';
    $('timer-hint').textContent = '这个题号已记住，下次抽取会避开。';
    renderCompletion();
    notify(storageOK ? '已记住这个题号，下次会避开。' : '本次已标记，浏览器未能保存题号。');
  }

  function undo() {
    if (!current) return;
    completed.delete(current.id);
    persist();
    updateCounts();
    renderCompletion();
    resetTimer();
    notify('已撤销，本题可以再次抽到。');
  }

  function requestReset() {
    if ($('about-dialog').open) $('about-dialog').close();
    $('confirm-dialog').showModal();
  }

  function clearCompleted() {
    completed.clear();
    persist();
    bag = [];
    current = null;
    resetTimer();
    updateCounts();
    $('confirm-dialog').close();
    $('active-card').hidden = true;
    $('empty').hidden = true;
    $('welcome').hidden = false;
    document.querySelector('.question-panel').setAttribute('aria-labelledby', 'card-heading');
    document.querySelector('.question-panel').removeAttribute('aria-label');
    $('draw-first').focus();
    notify('完成标记已清除，可以重新抽取。');
  }

  for (const category of categories) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = category.name;
    const description = document.createElement('span');
    description.className = 'description';
    description.textContent = category.description;
    name.append(description);
    const count = document.createElement('span');
    count.className = 'count';
    count.id = `count-${category.id}`;
    li.append(name, count);
    $('category-list').append(li);
  }
  completed = readCompleted();
  // Probe writes so Safari storage restrictions are visible before any marking.
  persist();
  updateCounts();
  $('view-theory').addEventListener('click', () => setCardView('theory'));
  $('view-practice').addEventListener('click', () => setCardView('practice'));
  $('card-switch').addEventListener('click', () => setCardView(cardView === 'theory' ? 'practice' : 'theory'));
  $('draw-first').addEventListener('click', draw);
  $('draw-next').addEventListener('click', draw);
  $('draw-change-top').addEventListener('click', draw);
  $('complete').addEventListener('click', complete);
  $('undo').addEventListener('click', undo);
  $('timer-toggle').addEventListener('click', toggleTimer);
  $('timer-reset').addEventListener('click', resetTimer);
  $('about-open').addEventListener('click', () => $('about-dialog').showModal());
  $('about-close').addEventListener('click', () => $('about-dialog').close());
  $('reset-open').addEventListener('click', requestReset);
  $('reset-empty').addEventListener('click', requestReset);
  $('reset-cancel').addEventListener('click', () => $('confirm-dialog').close());
  $('reset-confirm').addEventListener('click', clearCompleted);
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  window.addEventListener('pageshow', tick);
  // Other tabs may change the same ID set. Never store timestamps, notes or sessions.
  window.addEventListener('storage', event => {
    if (event.key !== KEY && event.key !== null) return;
    completed = readCompleted();
    updateCounts();
    if (current) {
      const nowDone = completed.has(current.id);
      const wasDone = $('complete').disabled;
      renderCompletion();
      if (nowDone !== wasDone) {
        resetTimer();
        if (nowDone) {
          $('timer-status').textContent = '本题已完成';
          $('timer-hint').textContent = '这个题号已记住，下次抽取会避开。';
        }
      }
    } else if (completed.size === cards.length) {
      draw();
    } else if (!$('empty').hidden) {
      bag = [];
      $('empty').hidden = true;
      $('welcome').hidden = false;
      document.querySelector('.question-panel').setAttribute('aria-labelledby', 'card-heading');
      document.querySelector('.question-panel').removeAttribute('aria-label');
    }
  });
  if (completed.size === cards.length) draw();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Online use is fully functional even when offline caching is unavailable.
    });
  }
})();
