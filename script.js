// Configuration
const WORKER_URL = 'https://ctguide.optimistprojects.workers.dev';
const BACKGROUND_IMAGES = [
    'https://raw.githubusercontent.com/0xTG/venice-mso/main/VeniceAI_Vf7NGoK.webp',
    'https://raw.githubusercontent.com/0xTG/venice-mso/main/VeniceAI_jXw0mwJ.webp',
    'https://raw.githubusercontent.com/0xTG/venice-mso/main/VeniceAI_sFkAxgA.webp'
];

// Background System (Shared across all pages)
BACKGROUND_IMAGES.forEach(url => new Image().src = url);

function rotateBackground() {
    document.body.style.backgroundImage = `url(${BACKGROUND_IMAGES[bgIndex]})`;
    bgIndex = (bgIndex + 1) % BACKGROUND_IMAGES.length;
}

let bgIndex = 0;
rotateBackground();
setInterval(rotateBackground, 30000);

// Chat-specific logic (only runs if elements exist)
const form = document.getElementById('chat-form');
const input = document.getElementById('input');
const chatbox = document.getElementById('chatbox');
const turnstileWidget = document.querySelector('.cf-turnstile');
let chatHistory = [];
let lastMessageTime = 0;
const RATE_LIMIT_MS = 3000; // 3 seconds
let isVerified = false;

if (form && input && chatbox) {
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const userMessage = input.value.trim();
        if (!userMessage) return;

        const now = Date.now();
        console.log('Submit attempt:', { now, lastMessageTime, diff: now - lastMessageTime });

        if (now - lastMessageTime < RATE_LIMIT_MS) {
            addMessage('bot', '⚠️ Please wait a few seconds before sending another message.');
            console.log('Rate limit triggered');
            return;
        }

        lastMessageTime = now;
        addMessage('user', userMessage);
        chatHistory.push({ sender: 'You', content: userMessage, timestamp: now });
        input.value = '';
        const submitButton = form.querySelector('button');
        if (submitButton) submitButton.disabled = true;
        console.log('Button disabled, processing started');

        const loadingMessage = addMessage('bot', '<span class="loading-dots"></span>', true);

        try {
            let token = null;
            if (!isVerified) {
                token = turnstileWidget?.getAttribute('data-response') || 
                        (typeof turnstile !== 'undefined' ? await turnstile.getResponse('.cf-turnstile') : null);

                if (!token) {
                    throw new Error('Please verify you are human first');
                }
            }

            const url = isVerified 
                ? `${WORKER_URL}?query=${encodeURIComponent(userMessage)}` 
                : `${WORKER_URL}?query=${encodeURIComponent(userMessage)}&cfToken=${encodeURIComponent(token)}`;

            console.log('Fetching:', url);
            const response = await fetch(url, {
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                const contentType = response.headers.get('content-type');
                let errorMessage = 'Unknown error';
                if (contentType && contentType.includes('application/json')) {
                    const errorData = await response.json();
                    errorMessage = errorData.error || `HTTP Error: ${response.status}`;
                } else {
                    errorMessage = await response.text() || `HTTP Error: ${response.status}`;
                }
                throw new Error(errorMessage);
            }

            const contentType = response.headers.get('content-type');
            if (contentType?.includes('text/event-stream')) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let content = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        if (!content.trim()) {
                            updateMessage(loadingMessage, '⚠️ No response received from server');
                            chatHistory.push({ sender: 'Bot', content: 'No response received', timestamp: Date.now() });
                        } else {
                            updateMessage(loadingMessage, formatText(content));
                            chatHistory.push({ sender: 'Bot', content: content.trim(), timestamp: Date.now() });
                        }
                        break;
                    }

                    buffer += decoder.decode(value, { stream: true });
                    const events = buffer.split('\n\n');
                    buffer = events.pop();

                    for (const event of events) {
                        if (!event.trim()) continue;
                        console.log('Raw event:', event);
                        const dataLine = event.split('\n').find(line => line.startsWith('data:'));
                        if (!dataLine || dataLine === 'data: [DONE]') continue;

                        try {
                            const data = JSON.parse(dataLine.slice(5));
                            console.log('Parsed data:', data);
                            if (data.choices?.[0]?.delta?.content) {
                                content += data.choices[0].delta.content;
                                updateMessage(loadingMessage, formatText(content));
                                if (loadingMessage.querySelector('.loading-dots')) {
                                    loadingMessage.querySelector('.loading-dots').remove();
                                }
                            }
                        } catch (e) {
                            console.error('Parse error:', e, 'Raw data:', dataLine);
                        }
                    }
                }
            } else if (contentType?.includes('application/json')) {
                const data = await response.json();
                const content = data.reply || 'No reply provided';
                updateMessage(loadingMessage, formatText(content));
                chatHistory.push({ sender: 'Bot', content, timestamp: Date.now() });
            } else {
                throw new Error('Unexpected response format');
            }

            if (!isVerified && token) {
                isVerified = true;
                if (turnstileWidget) turnstileWidget.style.display = 'none';
            }
        } catch (error) {
            updateMessage(loadingMessage, `⚠️ Error: ${error.message}`);
            chatHistory.push({ sender: 'Bot', content: `Error: ${error.message}`, timestamp: Date.now() });
            console.error('Submission error:', error);
        } finally {
            if (submitButton) submitButton.disabled = false;
            console.log('Processing complete, button enabled');
            input.focus();
        }
    });

    // Fix Enter key submission
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            console.log('Enter key pressed, submitting form');
            form.requestSubmit(); // Use requestSubmit to trigger form's submit event
        }
    });
}

// Helper Functions
function addMessage(sender, text, isHTML = false) {
    const div = document.createElement('div');
    div.className = `message ${sender}`;

    if (sender === 'bot') {
        const icon = document.createElement('img');
        icon.src = 'https://raw.githubusercontent.com/TGrahamGit/venice-mso/refs/heads/main/icon.png';
        icon.alt = 'Bot Icon';
        icon.className = 'bot-icon';
        div.appendChild(icon);

        const content = document.createElement('div');
        content.className = 'message-content';
        isHTML ? content.innerHTML = text : content.textContent = text;
        div.appendChild(content);
    } else {
        div.textContent = text; // Fixed typo from content.textContent
    }

    chatbox.appendChild(div);
    chatbox.scrollTop = chatbox.scrollHeight;
    return div;
}

function updateMessage(element, text) {
    const content = element.querySelector('.message-content');
    content.innerHTML = text;
    chatbox.scrollTop = chatbox.scrollHeight;
}

function formatText(text) {
    const lines = text.split('\n');
    let html = '';
    let inOrderedList = false;
    let inUnorderedList = false;
    let inCodeBlock = false;
    let inBlockquote = false;
    let listItems = [];
    let codeBlockContent = [];
    let blockquoteLines = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();

        if (line.startsWith('```')) {
            if (!inCodeBlock) {
                closePendingElements();
                inCodeBlock = true;
            } else {
                html += `<pre><code>${codeBlockContent.join('\n')}</code></pre>`;
                codeBlockContent = [];
                inCodeBlock = false;
            }
            continue;
        }
        if (inCodeBlock) {
            codeBlockContent.push(line);
            continue;
        }

        if (line.match(/^#{1,3}\s/)) {
            closePendingElements();
            const level = line.match(/^#+/)[0].length;
            const content = line.replace(/^#+\s/, '');
            html += `<h${level}>${inlineFormat(content)}</h${level}>`;
            continue;
        }

        if (line.match(/^\d+\.\s+/)) {
            if (!inOrderedList) closePendingElements();
            inOrderedList = true;
            inUnorderedList = false;
            listItems.push(`<li>${inlineFormat(line.replace(/^\d+\.\s+/, ''))}</li>`);
            continue;
        }

        if (line.match(/^[-*]\s+/)) {
            if (!inUnorderedList) closePendingElements();
            inUnorderedList = true;
            inOrderedList = false;
            listItems.push(`<li>${inlineFormat(line.replace(/^[-*]\s+/, ''))}</li>`);
            continue;
        }

        if (line.startsWith('>')) {
            if (!inBlockquote) closePendingElements();
            inBlockquote = true;
            blockquoteLines.push(inlineFormat(line.replace(/^>\s*/, '')));
            continue;
        }

        if (line && !inOrderedList && !inUnorderedList && !inBlockquote) {
            closePendingElements();
            html += `<p>${inlineFormat(line)}</p>`;
        } else if (!line && (inOrderedList || inUnorderedList || inBlockquote)) {
            closePendingElements();
        }
    }

    closePendingElements();

    return html || text;

    function closePendingElements() {
        if (listItems.length) {
            html += (inOrderedList ? '<ol>' : '<ul>') + listItems.join('') + (inOrderedList ? '</ol>' : '</ul>');
            listItems = [];
            inOrderedList = false;
            inUnorderedList = false;
        }
        if (blockquoteLines.length) {
            html += `<blockquote>${blockquoteLines.join('<br>')}</blockquote>`;
            blockquoteLines = [];
            inBlockquote = false;
        }
    }

    function inlineFormat(text) {
        text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/__(.*?)__/g, '<strong>$1</strong>');
        text = text.replace(/\*(.*?)\*/g, '<em>$1</em>').replace(/_(.*?)_/g, '<em>$1</em>');
        text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
        text = text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
        return text;
    }
}

function downloadChat() {
    if (!chatHistory.length) {
        alert('No chat history to download yet!');
        return;
    }
    const formattedChat = chatHistory.map(entry => {
        const date = new Date(entry.timestamp);
        return `[${date.toLocaleString()}] ${entry.sender}: ${entry.content}`;
    }).join('\n\n');
    const blob = new Blob([`Connecticut Vacation Guide Chat Log\nGenerated: ${new Date().toLocaleString()}\n\n${formattedChat}`], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'ct_vacation_chat_log.txt';
    link.click();
}

function usePrompt(text) {
    if (input) {
        input.value = text;
        form.requestSubmit();
    }
}
