async function showDebate(articleId, article) {
  if (!article) article = await API.articles.get(articleId);

  const app = document.getElementById('app');
  app.innerHTML = `
    <div id="screen-debate" class="screen active">
      <div class="screen-header">
        <button class="back-btn" id="debate-back">‹ Back</button>
        <h1>Debate</h1>
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
    </div>
  `;

  const conversation = document.getElementById('conversation');
  const textInput    = document.getElementById('debate-text-input');
  const sendTextBtn  = document.getElementById('send-text-btn');
  const micBtn       = document.getElementById('mic-btn');
  const endBtn       = document.getElementById('end-debate-btn');

  let history     = [];
  let debateMode  = 'text';
  let mediaRecorder = null;
  let audioChunks   = [];
  let isRecording   = false;
  let isThinking    = false;
  let userTurns     = 0;
  const MAX_TURNS   = 3;

  document.getElementById('article-ref').addEventListener('click', () => {
    Router.go('article', { id: articleId });
  });

  document.getElementById('debate-back').addEventListener('click', () => {
    if (history.length > 0 && !confirm('Exit? Your debate progress will be lost.')) return;
    Router.go('article', { id: articleId });
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
      const payload = { history: history.slice(0, -1), mode, content: userText };
      const data = await API.debate.message(articleId, payload);
      hideThinking();
      addBubble('assistant', data.assistant_text);
      history.push({ role: 'assistant', content: data.assistant_text });
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

  micBtn.addEventListener('click', async () => {
    if (isRecording) { mediaRecorder?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        isRecording = false;
        micBtn.classList.remove('recording');
        micBtn.textContent = '🎤 Tap to record';
        stream.getTracks().forEach(t => t.stop());

        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = reader.result.split(',')[1];
          if (isThinking) return;
          isThinking = true;
          endBtn.disabled = true;
          showThinking();
          try {
            const data = await API.debate.message(articleId, {
              history: history.slice(),
              mode: 'voice',
              audio: base64,
            });
            hideThinking();
            addBubble('user', data.user_text);
            history.push({ role: 'user', content: data.user_text });
            userTurns++;
            addBubble('assistant', data.assistant_text);
            history.push({ role: 'assistant', content: data.assistant_text });
            await speakText(data.assistant_text);
            if (userTurns >= MAX_TURNS) { await autoEnd(); return; }
          } catch (e) {
            hideThinking();
            addBubble('assistant', '[Error. Please try again.]');
          } finally {
            isThinking = false;
            if (userTurns < MAX_TURNS) endBtn.disabled = false;
          }
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorder.start();
      isRecording = true;
      micBtn.classList.add('recording');
      micBtn.textContent = '⏹ Tap to stop';
    } catch (e) {
      showToast('Microphone not available.');
    }
  });

  endBtn.addEventListener('click', async () => {
    if (history.length === 0) { showToast('Start the debate first!'); return; }
    if (!confirm('End debate and get your score?')) return;

    endBtn.disabled = true;
    endBtn.innerHTML = '<span class="spinner"></span> Scoring…';

    try {
      const result = await API.debate.end(articleId, { transcript: history, mode: debateMode });
      Router.go('score', { score: result.score, feedback: result.error_explanation_hebrew, articleId });
    } catch (e) {
      showToast('Scoring error. Try again.');
      endBtn.disabled = false;
      endBtn.textContent = 'End debate & get score';
    }
  });

  // Opening message from AI
  (async () => {
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
    } catch { hideThinking(); }
  })();
}
