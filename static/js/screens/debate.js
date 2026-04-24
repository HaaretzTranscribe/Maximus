async function showDebate(articleId, article) {
  if (!article) article = await API.articles.get(articleId);

  const app = document.getElementById('app');
  app.innerHTML = `
    <div id="screen-debate" class="screen active">
      <div class="screen-header">
        <button class="back-btn" id="debate-back">‹ Back</button>
        <h1>Debate</h1>
        <button class="btn btn-outline clear-debate-btn" id="clear-debate-btn" title="Start over">↺ Clear</button>
      </div>

      <div class="article-ref-collapsed">
        📰 <strong>${article.title}</strong>
        <button class="reread-btn" id="article-ref">Re-read ›</button>
      </div>

      <div class="mode-toggle">
        <button class="btn active" id="debate-mode-text">⌨️ Text</button>
        <button class="btn" id="debate-mode-voice">🎤 Voice</button>
      </div>

      <div class="conversation" id="conversation"></div>

      <div class="debate-input-area">
        <div id="debate-text-row">
          <textarea id="debate-text-input" rows="1" placeholder="Write in Italian…"></textarea>
          <button class="btn btn-primary" id="send-text-btn">➤</button>
        </div>
        <button class="btn btn-secondary btn-full hidden" id="mic-btn">🎤 Tap to record</button>
        <button class="btn btn-danger btn-full" id="end-debate-btn">End debate & get score</button>
      </div>

      <div class="translate-widget">
        <div class="translate-row">
          <input type="text" id="translate-input" placeholder="English word → Italian" />
          <button class="btn btn-outline" id="translate-btn">→</button>
        </div>
        <div class="translate-result hidden" id="translate-result"></div>
      </div>
    </div>
  `;

  const conversation   = document.getElementById('conversation');
  const textInput      = document.getElementById('debate-text-input');
  const sendTextBtn    = document.getElementById('send-text-btn');
  const micBtn         = document.getElementById('mic-btn');
  const endBtn         = document.getElementById('end-debate-btn');
  const translateInput = document.getElementById('translate-input');
  const translateBtn   = document.getElementById('translate-btn');
  const translateResult= document.getElementById('translate-result');

  let history     = [];
  let debateMode  = 'text';
  let mediaRecorder = null;
  let audioChunks   = [];
  let isRecording   = false;
  let isThinking    = false;
  let userTurns     = 0;
  const MAX_TURNS   = 3;
  const STORAGE_KEY = `debate_${articleId}`;

  document.getElementById('article-ref').addEventListener('click', () => {
    Router.go('article', { id: articleId });
  });

  document.getElementById('debate-back').addEventListener('click', () => {
    Router.go('article', { id: articleId });
  });

  document.getElementById('clear-debate-btn').addEventListener('click', () => {
    if (!confirm('Clear this debate and start over?')) return;
    clearProgress();
    Router.go('debate', { id: articleId, article });
  });

  document.getElementById('debate-mode-text').addEventListener('click', () => {
    debateMode = 'text';
    document.getElementById('debate-mode-text').classList.add('active');
    document.getElementById('debate-mode-voice').classList.remove('active');
    document.getElementById('debate-text-row').classList.remove('hidden');
    micBtn.classList.add('hidden');
  });

  document.getElementById('debate-mode-voice').addEventListener('click', () => {
    debateMode = 'voice';
    document.getElementById('debate-mode-voice').classList.add('active');
    document.getElementById('debate-mode-text').classList.remove('active');
    document.getElementById('debate-text-row').classList.add('hidden');
    micBtn.classList.remove('hidden');
  });

  function addBubble(role, text) {
    const div = document.createElement('div');
    div.className = `bubble bubble-${role}`;
    const label = role === 'user' ? 'You' : 'Maximus';
    div.innerHTML = `<div class="bubble-label">${label}</div>${escapeHtml(text)}`;
    conversation.appendChild(div);
    conversation.scrollTop = conversation.scrollHeight;
  }

  function showThinking() {
    const el = document.createElement('div');
    el.className = 'thinking-indicator';
    el.id = 'thinking';
    el.innerHTML = '<span></span><span></span><span></span>';
    conversation.appendChild(el);
    conversation.scrollTop = conversation.scrollHeight;
  }

  function hideThinking() {
    document.getElementById('thinking')?.remove();
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ history, userTurns }));
    } catch (_) {}
  }

  function clearProgress() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }

  function lockInput() {
    sendTextBtn.disabled = true;
    micBtn.disabled = true;
    textInput.disabled = true;
    textInput.placeholder = 'Debate complete.';
  }

  async function autoEnd() {
    lockInput();
    endBtn.textContent = 'Get your score →';
    endBtn.disabled = false;
    endBtn.classList.add('btn-primary');
    endBtn.classList.remove('btn-danger');
  }

  async function sendMessage(userText, mode) {
    if (isThinking) return;
    isThinking = true;
    sendTextBtn.disabled = true;
    endBtn.disabled = true;

    addBubble('user', userText);
    history.push({ role: 'user', content: userText });
    userTurns++;
    showThinking();

    try {
      const payload = { history: history.slice(0, -1), mode, content: userText, final_turn: userTurns >= MAX_TURNS };
      const data = await API.debate.message(articleId, payload);
      hideThinking();
      addBubble('assistant', data.assistant_text);
      history.push({ role: 'assistant', content: data.assistant_text });
      saveProgress();
      if (mode === 'voice') await speakText(data.assistant_text);
      if (userTurns >= MAX_TURNS) { await autoEnd(); return; }
    } catch (e) {
      hideThinking();
      addBubble('assistant', '[Network error. Please try again.]');
    } finally {
      isThinking = false;
      if (userTurns < MAX_TURNS) {
        sendTextBtn.disabled = false;
        endBtn.disabled = false;
      }
    }
  }

  async function speakText(text) {
    if (!('speechSynthesis' in window)) return;
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'it-IT';
    const voices = speechSynthesis.getVoices();
    const italian = voices.find(v => v.lang.startsWith('it'));
    if (italian) utt.voice = italian;
    utt.rate = 0.9;
    return new Promise(resolve => { utt.onend = resolve; speechSynthesis.speak(utt); });
  }

  sendTextBtn.addEventListener('click', () => {
    const text = textInput.value.trim();
    if (!text) return;
    textInput.value = '';
    textInput.style.height = 'auto';
    sendMessage(text, 'text');
  });

  textInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTextBtn.click(); }
  });
  textInput.addEventListener('input', () => {
    textInput.style.height = 'auto';
    textInput.style.height = textInput.scrollHeight + 'px';
  });

  async function doTranslate() {
    const word = translateInput.value.trim();
    if (!word) return;
    translateBtn.disabled = true;
    translateBtn.textContent = '…';
    translateResult.classList.add('hidden');
    try {
      const data = await API.debate.translate(word);
      translateResult.textContent = data.italian;
      translateResult.classList.remove('hidden');
    } catch (_) {
      translateResult.textContent = 'Error — try again.';
      translateResult.classList.remove('hidden');
    } finally {
      translateBtn.disabled = false;
      translateBtn.textContent = '→';
    }
  }

  translateBtn.addEventListener('click', doTranslate);
  translateInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doTranslate(); }
  });

  // Voice mode — continuous recognition, manual Send button
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let activeRecog = null;
  let liveTranscript = '';

  // Insert send-voice button (hidden by default)
  const sendVoiceBtn = document.createElement('button');
  sendVoiceBtn.id = 'send-voice-btn';
  sendVoiceBtn.className = 'btn btn-primary btn-full hidden';
  sendVoiceBtn.textContent = '✓ Send answer';
  micBtn.parentElement.insertBefore(sendVoiceBtn, micBtn.nextSibling);

  micBtn.addEventListener('click', () => {
    if (isRecording || isThinking) return;
    if (!SpeechRecognition) { showToast('Speech recognition not supported on this browser.'); return; }

    liveTranscript = '';
    const recog = new SpeechRecognition();
    activeRecog = recog;
    recog.lang = 'it-IT';
    recog.continuous = true;
    recog.interimResults = true;

    recog.onstart = () => {
      isRecording = true;
      micBtn.classList.add('recording');
      micBtn.textContent = '🔴 Recording…';
      sendVoiceBtn.classList.remove('hidden');
      endBtn.classList.add('hidden');
    };

    recog.onresult = (e) => {
      let interim = '';
      liveTranscript = '';
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) liveTranscript += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      micBtn.textContent = `🔴 ${liveTranscript || interim || '…'}`;
    };

    recog.onerror = (e) => {
      if (e.error !== 'no-speech') showToast('Recognition error. Try again.');
    };

    recog.onend = () => {
      isRecording = false;
      activeRecog = null;
      micBtn.classList.remove('recording');
      micBtn.textContent = '🎤 Tap to record';
      sendVoiceBtn.classList.add('hidden');
      endBtn.classList.remove('hidden');
    };

    recog.start();
  });

  async function submitVoice() {
    if (activeRecog) { activeRecog.stop(); activeRecog = null; }
    const userText = liveTranscript.trim();
    if (!userText) { showToast('Nothing recorded.'); return; }

    userTurns++;
    isThinking = true;
    endBtn.disabled = true;
    addBubble('user', userText);
    history.push({ role: 'user', content: userText });
    showThinking();
    try {
      const data = await API.debate.message(articleId, {
        history: history.slice(0, -1),
        mode: 'voice',
        content: userText,
        final_turn: userTurns >= MAX_TURNS,
      });
      hideThinking();
      addBubble('assistant', data.assistant_text);
      history.push({ role: 'assistant', content: data.assistant_text });
      saveProgress();
      await speakText(data.assistant_text);
      if (userTurns >= MAX_TURNS) { await autoEnd(); return; }
    } catch (err) {
      hideThinking();
      addBubble('assistant', '[Error. Please try again.]');
    } finally {
      isThinking = false;
      if (userTurns < MAX_TURNS) endBtn.disabled = false;
    }
  }

  sendVoiceBtn.addEventListener('click', submitVoice);

  let endTapOnce = false;
  endBtn.addEventListener('click', async () => {
    if (history.length === 0) { showToast('Start the debate first!'); return; }
    if (!endTapOnce && userTurns < MAX_TURNS) {
      endTapOnce = true;
      showToast('Tap again to end early and get your score.');
      setTimeout(() => { endTapOnce = false; }, 3000);
      return;
    }

    endBtn.disabled = true;
    endBtn.innerHTML = '<span class="spinner"></span> Scoring…';

    try {
      const result = await API.debate.end(articleId, { transcript: history, mode: debateMode });
      clearProgress();
      Router.go('score', { score: result.score, feedback: result.error_explanation_hebrew, articleId });
    } catch (e) {
      showToast('Scoring error. Try again.');
      endBtn.disabled = false;
      endBtn.textContent = 'End debate & get score';
    }
  });

  // Restore saved debate or start fresh
  (async () => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (_) {}

    if (saved && saved.history && saved.history.length > 0) {
      history = saved.history;
      userTurns = saved.userTurns || 0;
      history.forEach(msg => addBubble(msg.role === 'user' ? 'user' : 'assistant', msg.content));
      if (userTurns >= MAX_TURNS) await autoEnd();
    } else {
      showThinking();
      try {
        const data = await API.debate.message(articleId, {
          history: [],
          mode: 'text',
          content: `Ciao! Ho letto l'articolo "${article.title}". Sono pronto a discuterne.`,
        });
        hideThinking();
        addBubble('assistant', data.assistant_text);
        history = [
          { role: 'user', content: `Ciao! Ho letto l'articolo "${article.title}". Sono pronto a discuterne.` },
          { role: 'assistant', content: data.assistant_text },
        ];
        saveProgress();
      } catch { hideThinking(); }
    }
  })();
}
