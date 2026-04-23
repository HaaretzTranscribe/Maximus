async function showDebate(articleId, article) {
  if (!article) article = await API.articles.get(articleId);

  const app = document.getElementById('app');
  app.innerHTML = `
    <div id="screen-debate" class="screen active">
      <div class="screen-header">
        <button class="back-btn" id="debate-back">‹</button>
        <h1>Dibattito</h1>
      </div>

      <div class="article-ref-collapsed" id="article-ref">
        <strong>${article.title}</strong> — tocca per rileggere
      </div>

      <div class="mode-toggle">
        <button class="btn active" id="debate-mode-text">⌨ Testo</button>
        <button class="btn" id="debate-mode-voice">🎤 Voce</button>
      </div>

      <div class="conversation" id="conversation"></div>

      <div class="debate-input-area">
        <div id="debate-text-row">
          <textarea id="debate-text-input" rows="1" placeholder="Scrivi in italiano…"></textarea>
          <button class="btn btn-primary" id="send-text-btn">➤</button>
        </div>
        <button class="btn btn-secondary btn-full hidden" id="mic-btn">🎤 Tieni premuto per parlare</button>
        <button class="btn btn-danger btn-full" id="end-debate-btn">Termina e ottieni il punteggio</button>
      </div>
    </div>
  `;

  const conversation = document.getElementById('conversation');
  const textInput    = document.getElementById('debate-text-input');
  const sendTextBtn  = document.getElementById('send-text-btn');
  const micBtn       = document.getElementById('mic-btn');
  const endBtn       = document.getElementById('end-debate-btn');

  let history = [];  // [{role, content}]
  let debateMode = 'text';
  let mediaRecorder = null;
  let audioChunks   = [];
  let isRecording   = false;
  let isThinking    = false;

  // Article ref tap → article view
  document.getElementById('article-ref').addEventListener('click', () => {
    Router.go('article', { id: articleId });
  });

  // Back
  document.getElementById('debate-back').addEventListener('click', () => {
    if (history.length > 0 && !confirm('Vuoi davvero uscire? Il dibattito verrà perso.')) return;
    Router.go('article', { id: articleId });
  });

  // Mode toggle
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
    const label = role === 'user' ? 'Tu' : 'Maximus';
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

  async function sendMessage(userText, mode) {
    if (isThinking) return;
    isThinking = true;
    sendTextBtn.disabled = true;
    endBtn.disabled = true;

    addBubble('user', userText);
    history.push({ role: 'user', content: userText });
    showThinking();

    try {
      const payload = { history: history.slice(0, -1), mode, content: userText };
      const data = await API.debate.message(articleId, payload);
      hideThinking();
      addBubble('assistant', data.assistant_text);
      history.push({ role: 'assistant', content: data.assistant_text });

      // Voice mode: speak the response
      if (mode === 'voice') {
        await speakText(data.assistant_text);
      }
    } catch (e) {
      hideThinking();
      addBubble('assistant', '[Errore di rete. Riprova.]');
    } finally {
      isThinking = false;
      sendTextBtn.disabled = false;
      endBtn.disabled = false;
    }
  }

  async function speakText(text) {
    // Use browser TTS for AI responses in voice mode (avoids round-trip cost)
    if ('speechSynthesis' in window) {
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = 'it-IT';
      const voices = speechSynthesis.getVoices();
      const italian = voices.find(v => v.lang.startsWith('it'));
      if (italian) utt.voice = italian;
      utt.rate = 0.9;
      return new Promise(resolve => {
        utt.onend = resolve;
        speechSynthesis.speak(utt);
      });
    }
  }

  // Text send
  sendTextBtn.addEventListener('click', () => {
    const text = textInput.value.trim();
    if (!text) return;
    textInput.value = '';
    textInput.style.height = 'auto';
    sendMessage(text, 'text');
  });
  textInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendTextBtn.click();
    }
  });
  textInput.addEventListener('input', () => {
    textInput.style.height = 'auto';
    textInput.style.height = textInput.scrollHeight + 'px';
  });

  // Voice recording
  micBtn.addEventListener('click', async () => {
    if (isRecording) {
      mediaRecorder?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        isRecording = false;
        micBtn.classList.remove('recording');
        micBtn.textContent = '🎤 Tieni premuto per parlare';
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
            addBubble('assistant', data.assistant_text);
            history.push({ role: 'assistant', content: data.assistant_text });
            await speakText(data.assistant_text);
          } catch (e) {
            hideThinking();
            addBubble('assistant', '[Errore. Riprova.]');
          } finally {
            isThinking = false;
            endBtn.disabled = false;
          }
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorder.start();
      isRecording = true;
      micBtn.classList.add('recording');
      micBtn.textContent = '⏹ Tocca per fermare';
    } catch (e) {
      showToast('Microfono non disponibile.');
    }
  });

  // End debate
  endBtn.addEventListener('click', async () => {
    if (history.length === 0) {
      showToast('Inizia prima il dibattito!');
      return;
    }
    if (!confirm('Terminare il dibattito e ottenere il punteggio?')) return;

    endBtn.disabled = true;
    endBtn.innerHTML = '<span class="spinner"></span> Valutazione…';

    const mode = debateMode === 'voice'
      ? (history.some(m => m.role === 'user') ? 'voice' : 'text')
      : 'text';

    try {
      const result = await API.debate.end(articleId, { transcript: history, mode });
      Router.go('score', { score: result.score, feedback: result.error_explanation_hebrew, articleId });
    } catch (e) {
      showToast('Errore durante la valutazione. Riprova.');
      endBtn.disabled = false;
      endBtn.textContent = 'Termina e ottieni il punteggio';
    }
  });

  // Greeting from the AI to open the debate
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
    } catch {
      hideThinking();
    }
  })();
}
