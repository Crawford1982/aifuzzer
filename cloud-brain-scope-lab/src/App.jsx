import React, { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

/**
 * If the message is only http(s) URLs (one per line and/or comma-separated), returns them.
 * Otherwise null so normal chat handles the text.
 */
function parsePlainPolicyUrls(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const tokens = raw.match(/https?:\/\/[^\s,]+/gi) || [];
  if (tokens.length === 0) return null;

  // Accept URL-only messages with flexible separators (spaces/newlines/commas).
  const remainder = raw
    .replace(/https?:\/\/[^\s,]+/gi, ' ')
    .replace(/[\s,]+/g, '')
    .trim();
  if (remainder) return null;

  const urls = [];
  for (const token of tokens) {
    try {
      const cleaned = token.trim().replace(/[)\].,;]+$/g, '');
      const u = new URL(cleaned);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      const host = u.hostname.toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
        continue;
      }
      urls.push(u.href);
    } catch {
      return null;
    }
  }
  return urls.length ? urls : null;
}

/** HackerOne program policy pages → fuzz plan (/plan), not scout-only (/scope). */
function isHackerOnePolicyPageUrl(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (h !== 'hackerone.com' && h !== 'www.hackerone.com') return false;
    const p = u.pathname.toLowerCase();
    if (p.includes('/policy_scopes')) return true;
    if (/\/[^/]+\/policy\/?$/i.test(u.pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

/** Messages that belong to the scope/plan/fuzz pipeline (not general chat). */
function isLabRelatedMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (msg.lab === true) return true;
  if (msg.kind === 'plan') return true;
  const c = String(msg.content || '');
  if (c.includes('## Fuzz run') || c.includes('Fuzz run starting')) return true;
  if (c.includes('### Scope Scout') || c.includes('### Scope Skeptic') || c.includes('### Run Planner'))
    return true;
  if (c.includes('Scope Discussion Summary')) return true;
  if (c.includes('Routing profile:') && c.includes('Candidate targets')) return true;
  return false;
}

/** Short, host-unique label for rendering in the probe table so rows aren't ambiguous
 *  when a plan includes multiple targets that each emit a baseline/idor/debug/routing probe. */
function shortTargetLabel(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname && u.pathname !== '/' ? u.pathname : '';
    return path ? `${host}${path}` : host;
  } catch {
    return String(url || '').slice(0, 60);
  }
}

function PlanWidget({
  plan,
  approved,
  onToggle,
  onSelectAll,
  onLaunch,
  loading,
  authTokenSet,
  onOpenAuthPanel,
  onDiscoverSurface,
  discovering,
  surfaceResult
}) {
  const allChecked =
    plan.candidates.length > 0 && plan.candidates.every((c) => approved.has(c));
  const someChecked = plan.candidates.some((c) => approved.has(c));
  return (
    <div className="plan-widget">
      <div className="plan-header">
        <span className="plan-title">Fuzz plan ready</span>
        <span className="plan-badge">{plan.profile}</span>
      </div>
      <div className="plan-meta">
        <div>
          <strong>Plan ID:</strong> <code>{plan.planId}</code>
        </div>
        <div>
          <strong>Policy:</strong> {plan.policyUrl}
        </div>
        {plan.browse?.used ? (
          <div>
            <strong>Browse:</strong>{' '}
            {plan.browse.ok ? `ok (${plan.browse.finalUrl || 'rendered'})` : `skipped/failed`}
          </div>
        ) : null}
      </div>

      {plan.candidates.length === 0 ? (
        <div className="plan-empty">
          <p>No probe-ready <code>https://</code> candidate URLs were extracted.</p>
          {plan.hostPatterns?.length > 0 ? (
            <>
              <p>In-scope patterns from the program (often wildcards — cannot fuzz literally):</p>
              <ul className="plan-pattern-list">
                {plan.hostPatterns.slice(0, 40).map((p) => (
                  <li key={p}>
                    <code>{p}</code>
                  </li>
                ))}
              </ul>
              <p className="plan-empty-hint">
                Bare hostnames from HackerOne should appear above as https seeds when GraphQL succeeds.
                If this list is empty too, check pipeline notes — the H1 API may have failed (network/block).
              </p>
              {onDiscoverSurface ? (
                <button
                  type="button"
                  className="surface-discover-btn"
                  onClick={onDiscoverSurface}
                  disabled={loading || discovering}
                >
                  {discovering ? 'Discovering…' : 'Discover API surface on wildcard hosts'}
                </button>
              ) : null}
            </>
          ) : (
            <p>
              Try <code>/scope-browse &lt;url&gt;</code> for JS-rendered pages, or use <code>/plan</code> with
              the policy URL (not hacktivity).
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="plan-controls">
            <label className="plan-select-all">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(el) => {
                  if (el) el.indeterminate = !allChecked && someChecked;
                }}
                onChange={(e) => onSelectAll(e.target.checked)}
                disabled={loading}
              />
              <span>
                {allChecked ? 'Deselect all' : 'Select all'} ({approved.size}/
                {plan.candidates.length} approved)
              </span>
            </label>
            <button
              type="button"
              className="auth-toggle-btn"
              onClick={onOpenAuthPanel}
              disabled={loading}
              title={
                authTokenSet
                  ? 'Auth token is set for this session (not saved).'
                  : 'No auth token set — probes will run unauthenticated.'
              }
            >
              {authTokenSet ? 'Auth: set' : 'Auth: none'}
            </button>
            {onDiscoverSurface ? (
              <button
                type="button"
                className="surface-discover-btn"
                onClick={onDiscoverSurface}
                disabled={loading || discovering}
                title="Probe common API prefixes on approved hosts to find real endpoints before fuzzing."
              >
                {discovering ? 'Discovering…' : 'Discover API surface'}
              </button>
            ) : null}
            <button
              type="button"
              className="launch-btn"
              onClick={onLaunch}
              disabled={loading || approved.size === 0}
            >
              Launch fuzzer ({approved.size})
            </button>
          </div>
          <ul className="plan-candidates">
            {plan.candidates.map((url) => (
              <li key={url}>
                <label>
                  <input
                    type="checkbox"
                    checked={approved.has(url)}
                    onChange={() => onToggle(url)}
                    disabled={loading}
                  />
                  <span className="candidate-url">{url}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      {surfaceResult ? (
        <details className="plan-section" open>
          <summary>
            Surface discovery: {surfaceResult.stats.approved} approved /{' '}
            {surfaceResult.stats.tried} tried
          </summary>
          {surfaceResult.approvedTargets.length > 0 ? (
            <>
              <p className="plan-empty-hint">
                API-like endpoints added to the candidate list. Review and approve.
              </p>
              <ul className="plan-pattern-list">
                {surfaceResult.approvedTargets.slice(0, 40).map((u) => (
                  <li key={u}>
                    <code>{u}</code>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="plan-empty-hint">
              No API-like endpoints found on these hosts (all probes returned CDN edges, HTML,
              or non-JSON). Consider using <code>/scope-browse</code> to find a real API host.
            </p>
          )}
        </details>
      ) : null}

      {plan.outOfScopeNotes?.length > 0 ? (
        <details className="plan-section">
          <summary>Out-of-scope notes ({plan.outOfScopeNotes.length})</summary>
          <ul>
            {plan.outOfScopeNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {plan.notes?.length > 0 ? (
        <details className="plan-section">
          <summary>Pipeline notes ({plan.notes.length})</summary>
          <ul>
            {plan.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {plan.safety?.length > 0 ? (
        <div className="plan-safety">
          {plan.safety.map((s, i) => (
            <div key={i}>- {s}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AuthPanel({ open, currentlySet, onSave, onClear, onClose }) {
  const [draft, setDraft] = useState('');
  useEffect(() => {
    if (open) setDraft('');
  }, [open]);
  if (!open) return null;
  return (
    <div className="auth-panel-backdrop" onClick={onClose}>
      <div className="auth-panel" onClick={(e) => e.stopPropagation()}>
        <h3>Session auth token</h3>
        <p className="auth-panel-help">
          Used for authenticated GET probes. Paste a <strong>Bearer</strong> session/JWT, a
          line starting with <code>Api-Token</code> (Dynatrace), or the full{' '}
          <code>Authorization: …</code> header — memory only, not saved to chats, not logged.
          Reload clears it.
        </p>
        <input
          type="password"
          className="auth-panel-input"
          placeholder="Bearer … / Api-Token … / Authorization: …"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
        />
        <div className="auth-panel-actions">
          {currentlySet ? (
            <button type="button" className="auth-clear-btn" onClick={onClear}>
              Clear current token
            </button>
          ) : null}
          <div className="auth-panel-spacer" />
          <button type="button" className="auth-cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="auth-save-btn"
            onClick={() => onSave(draft.trim())}
            disabled={!draft.trim()}
          >
            Save for this session
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const MAX_FILES = 12;
  const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
  const [conversations, setConversations] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState('gemma4-31');
  const [models, setModels] = useState({});
  const [imageModels, setImageModels] = useState({});
  const [imageModel, setImageModel] = useState('gemini');
  const [loading, setLoading] = useState(false);
  const [longAnswerMode, setLongAnswerMode] = useState(false);
  const [title, setTitle] = useState('New Conversation');
  const [createdAt, setCreatedAt] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [copiedMsgIndex, setCopiedMsgIndex] = useState(null);
  // Session-only auth token for fuzz runs. Stored in a ref so it NEVER
  // reaches the messages array (which is persisted to conversations/*.json).
  const authTokenRef = useRef('');
  const [authTokenSet, setAuthTokenSet] = useState(false);
  const [showAuthPanel, setShowAuthPanel] = useState(false);
  // Tracks the "approve targets" UI state, keyed by planId.
  const [approvalState, setApprovalState] = useState({});
  // Per-plan state for surface-discovery in-flight + last results.
  const [discoveringPlanId, setDiscoveringPlanId] = useState(null);
  const [surfaceResults, setSurfaceResults] = useState({}); // planId -> result
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  /** `chat` = full LLM conversation. `lab` = only scope/plan/fuzz — no stray chat replies. */
  const [workspaceMode, setWorkspaceMode] = useState(() => {
    try {
      const v = localStorage.getItem('cloudBrainWorkspace');
      return v === 'lab' ? 'lab' : 'chat';
    } catch {
      return 'chat';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('cloudBrainWorkspace', workspaceMode);
    } catch {
      /* ignore */
    }
  }, [workspaceMode]);

  const displayMessages = useMemo(() => {
    if (workspaceMode !== 'lab') return messages;
    return messages.filter(isLabRelatedMessage);
  }, [messages, workspaceMode]);

  const modelGuide = {
    auto: 'Automatically route to the best model per task',
    'gemma4-31': 'General chat, balanced quality',
    'gemma4-26': 'Fastest replies',
    'deepseek-r1': 'Deep reasoning and step-by-step thinking',
    kimi: 'Longer writing and planning'
  };

  useEffect(() => {
    fetch('/api/models')
      .then((r) => r.json())
      .then(setModels)
      .catch(console.error);
    fetch('/api/image-models')
      .then((r) => r.json())
      .then(setImageModels)
      .catch(console.error);
  }, []);

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMessages]);

  useEffect(() => {
    if (currentId) {
      // Defensive: never persist auth-related transient fields to disk,
      // even though we already keep authTokenRef out of messages.
      const sanitizedMessages = messages.map((m) => {
        if (!m || typeof m !== 'object') return m;
        const clone = { ...m };
        delete clone._authToken; // belt-and-suspenders: no stray copies
        return clone;
      });
      const saveData = {
        id: currentId,
        title,
        model,
        createdAt: createdAt || new Date().toISOString(),
        messages: sanitizedMessages
      };
      fetch(`/api/conversations/${currentId}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saveData)
      }).catch(console.error);
    }
  }, [messages, title, model, currentId, createdAt]);

  const loadConversations = async () => {
    try {
      const res = await fetch('/api/conversations');
      const convos = await res.json();
      setConversations(Array.isArray(convos) ? convos : []);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  const createNew = async () => {
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Conversation', model })
      });
      const convo = await res.json();
      setCurrentId(convo.id);
      setMessages([]);
      setTitle(convo.title || 'New Conversation');
      setCreatedAt(convo.createdAt || new Date().toISOString());
      await loadConversations();
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const loadConversation = async (id) => {
    try {
      const res = await fetch(`/api/conversations/${id}`);
      const convo = await res.json();
      setCurrentId(id);
      setMessages(convo.messages || []);
      setTitle(convo.title || 'Untitled');
      setModel(convo.model || 'gemma4-31');
      setCreatedAt(convo.createdAt || new Date().toISOString());
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const deleteConversation = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this conversation?')) return;
    try {
      await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      if (currentId === id) {
        setCurrentId(null);
        setMessages([]);
      }
      await loadConversations();
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  const generateImageFromPrompt = async (prompt) => {
    const cleanedPrompt = String(prompt || '').trim();
    if (!cleanedPrompt || loading || !currentId) return;
    if (workspaceMode === 'lab') {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          model,
          lab: true,
          content:
            'Image generation runs in **Chat** workspace. Switch the toggle above to **Chat**, or type `/image` there.'
        }
      ]);
      setInput('');
      return;
    }
    const userMessage = { role: 'user', content: `/image ${cleanedPrompt}` };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    try {
      const response = await fetch('/api/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: cleanedPrompt, imageModel })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.text || 'Generated image:',
          model: data.model,
          imageUrls: data.imageUrls || []
        }
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${error.message || 'Failed to generate image.'}`,
          model: imageModel
        }
      ]);
    } finally {
      setLoading(false);
      await loadConversations();
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading || !currentId) return;

    const typedInput = input.trim();
    if (typedInput.toLowerCase().startsWith('/image ')) {
      await generateImageFromPrompt(typedInput.slice(7));
      return;
    }
    if (typedInput.toLowerCase().startsWith('/scope ')) {
      await runScopeDiscussion({
        policyUrl: typedInput.slice(7),
        profile: 'balanced',
        browse: false,
        userContent: typedInput
      });
      return;
    }
    if (typedInput.toLowerCase().startsWith('/scope-free ')) {
      await runScopeDiscussion({
        policyUrl: typedInput.slice(12),
        profile: 'free',
        browse: false,
        userContent: typedInput
      });
      return;
    }
    if (typedInput.toLowerCase().startsWith('/scope-premium ')) {
      await runScopeDiscussion({
        policyUrl: typedInput.slice(15),
        profile: 'premium',
        browse: false,
        userContent: typedInput
      });
      return;
    }
    if (typedInput.toLowerCase().startsWith('/scope-browse ')) {
      await runScopeDiscussion({
        policyUrl: typedInput.slice(14),
        profile: 'balanced',
        browse: true,
        userContent: typedInput
      });
      return;
    }
    if (typedInput.toLowerCase().startsWith('/scope-browse-free ')) {
      await runScopeDiscussion({
        policyUrl: typedInput.slice(19),
        profile: 'free',
        browse: true,
        userContent: typedInput
      });
      return;
    }
    if (typedInput.toLowerCase().startsWith('/scope-browse-premium ')) {
      await runScopeDiscussion({
        policyUrl: typedInput.slice(22),
        profile: 'premium',
        browse: true,
        userContent: typedInput
      });
      return;
    }
    if (typedInput.toLowerCase().startsWith('/plan ')) {
      await runPlanAndFuzz({
        policyUrl: typedInput.slice(6),
        profile: 'balanced',
        browse: false,
        userContent: typedInput
      });
      return;
    }
    if (typedInput.toLowerCase().startsWith('/fuzz ')) {
      await runFuzz({ planId: typedInput.slice(6).trim(), userContent: typedInput });
      return;
    }

    const filesToSendPreview = [...attachments];
    if (filesToSendPreview.length === 0) {
      const plainUrls = parsePlainPolicyUrls(typedInput);
      if (plainUrls?.length) {
        for (const url of plainUrls) {
          if (isHackerOnePolicyPageUrl(url)) {
            await runPlanAndFuzz({
              policyUrl: url,
              profile: 'balanced',
              browse: false,
              userContent: url
            });
          } else {
            await runScopeDiscussion({
              policyUrl: url,
              profile: 'balanced',
              browse: false,
              userContent: url
            });
          }
        }
        return;
      }
    }

    if (workspaceMode === 'lab') {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          model,
          lab: true,
          content:
            '**Scope & fuzz** does not send free-form text to the chat model. Use `/plan`, `/fuzz`, `/scope…`, paste policy URLs only, or switch to **Chat** above for normal conversation and attachments.'
        }
      ]);
      setInput('');
      return;
    }

    const selectedModelAtSend = model;
    const filesToSend = [...attachments];
    const userMessage = { role: 'user', content: typedInput };
    const historyBeforeUser = [...messages];
    const newMessages = [...historyBeforeUser, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    if (historyBeforeUser.length === 0) {
      setTitle(typedInput.slice(0, 50) + (typedInput.length > 50 ? '...' : ''));
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        ...(filesToSend.length === 0
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: typedInput,
                model: selectedModelAtSend,
                messages: historyBeforeUser,
                longAnswer: longAnswerMode
              })
            }
          : {
              body: (() => {
                const form = new FormData();
                form.append('message', typedInput);
                form.append('model', selectedModelAtSend);
                form.append('messages', JSON.stringify(historyBeforeUser));
                form.append('longAnswer', String(longAnswerMode));
                filesToSend.forEach((file) => form.append('files', file));
                return form;
              })()
            })
      });

      if (!response.ok) {
        let errorText = `HTTP ${response.status}`;
        try {
          const data = await response.json();
          if (data?.error) errorText = data.error;
        } catch (_err) {
          try {
            const text = await response.text();
            if (text) errorText = text.slice(0, 200);
          } catch (_innerErr) {
            // Keep fallback error text.
          }
        }
        throw new Error(errorText);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream')) {
        let errorText = 'Server did not return a stream response';
        try {
          const data = await response.json();
          if (data?.error) errorText = data.error;
        } catch (_err) {
          // Keep generic fallback.
        }
        throw new Error(errorText);
      }

      if (!response.body) {
        throw new Error('No response stream');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = '';

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: '',
          model: selectedModelAtSend
        }
      ]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const json = JSON.parse(data);
            if (json.model) {
              setMessages((prev) => {
                const updated = [...prev];
                if (updated.length > 0) {
                  updated[updated.length - 1] = {
                    ...updated[updated.length - 1],
                    model: json.model,
                    maxTokens: json.maxTokens
                  };
                }
                return updated;
              });
            } else if (json.error) {
              assistantMessage = `Error: ${json.error}`;
            } else if (json.content) {
              assistantMessage += json.content;
            }

            setMessages((prev) => {
              const updated = [...prev];
              if (updated.length > 0) {
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  content: assistantMessage
                };
              }
              return updated;
            });
          } catch (_e) {
            // Ignore parse errors from partial chunks.
          }
        }
      }
      setAttachments([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${error.message || 'Failed to get response. Check API key or model limits.'}`,
          model: selectedModelAtSend
        }
      ]);
    } finally {
      setLoading(false);
      await loadConversations();
    }
  };

  const generateImage = async () => generateImageFromPrompt(input);

  const runScopeDiscussion = async ({
    policyUrl,
    profile = 'balanced',
    browse = false,
    userContent
  }) => {
    const url = String(policyUrl || '').trim();
    if (!url || loading || !currentId) return;

    const userMessage = {
      role: 'user',
      content: userContent || (browse ? `/scope-browse ${url}` : `/scope ${url}`),
      lab: true
    };
    const historyBeforeUser = [...messages];
    const newMessages = [...historyBeforeUser, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    if (historyBeforeUser.length === 0) {
      setTitle(`Scope: ${url.slice(0, 42)}${url.length > 42 ? '...' : ''}`);
    }

    try {
      const res = await fetch('/api/scope/discuss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policyUrl: url, model, profile, browse })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      const discussionMsgs = (data.discussion || []).map((d) => ({
        role: 'assistant',
        model: d.modelKey || model,
        lab: true,
        content: `### ${d.agent}\n\n${d.content || ''}`
      }));

      const candidates = (data.candidateTargets || []).slice(0, 8);
      const candidateText = candidates.length
        ? candidates.map((u) => `- ${u}`).join('\n')
        : '- none extracted';
      const notes = Array.isArray(data.notes) && data.notes.length
        ? `\n\nNotes:\n${data.notes.map((n) => `- ${n}`).join('\n')}`
        : '';

      const browseLine =
        data.browse?.used === true
          ? `Browse: ${data.browse.ok ? `ok (${data.browse.finalUrl || url})` : `failed${data.browse.error ? `: ${data.browse.error}` : ''}`}\n`
          : '';
      const visionLine =
        data.routing?.visionExtractor != null
          ? `Vision extractor: ${data.routing.visionExtractor}\n`
          : '';

      const summaryMsg = {
        role: 'assistant',
        model: data.routing?.summary || model,
        lab: true,
        content:
          `Routing profile: ${data.profile || profile}\n` +
          browseLine +
          visionLine +
          (data.routing
            ? `Models: extractor=${data.routing.extractor}, scout=${data.routing.scout}, skeptic=${data.routing.skeptic}, planner=${data.routing.planner}, summary=${data.routing.summary}\n\n`
            : '\n') +
          `## Scope Discussion Summary\n\n${data.summary || 'No summary generated.'}` +
          `\n\n### Candidate targets\n${candidateText}${notes}`
      };

      setMessages((prev) => [...prev, ...discussionMsgs, summaryMsg]);
      await loadConversations();
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          model,
          lab: true,
          content: `Error: ${error.message || 'Failed to run scope discussion.'}`
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const runPlanAndFuzz = async ({ policyUrl, profile = 'balanced', browse = false, userContent }) => {
    const url = String(policyUrl || '').trim();
    if (!url || loading || !currentId) return;

    const userMessage = { role: 'user', content: userContent || `/plan ${url}`, lab: true };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/scope/plan-and-fuzz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policyUrl: url, profile, browse })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      const candidates = data.candidateTargets || [];
      // Render the plan as a structured widget; App will render the widget
      // from msg.kind === 'plan' (no msg.content fallback to avoid
      // duplicate/stale-markdown rendering alongside the widget).
      // msg.model is set to the *actual extractor model used*, so the
      // "via <model>" line reflects scope extraction (not the chat model).
      const planMsg = {
        role: 'assistant',
        model: data.extractorModel || model,
        lab: true,
        kind: 'plan',
        plan: {
          planId: data.planId,
          policyUrl: data.policyUrl,
          profile: data.profile,
          candidates,
          hostPatterns: data.hostPatterns || [],
          outOfScopeNotes: data.outOfScopeNotes || [],
          rules: data.rules || [],
          notes: data.notes || [],
          safety: data.safety || [],
          browse: data.browse || null,
          extractorModel: data.extractorModel || null,
          visionModel: data.visionModel || null
        },
        content: ''
      };

      // Default: all candidates pre-checked so the "approve all" button
      // is one click; user can untick anything they don't want probed.
      setApprovalState((prev) => ({
        ...prev,
        [data.planId]: new Set(candidates)
      }));

      setMessages((prev) => [...prev, planMsg]);
      await loadConversations();
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          model,
          lab: true,
          content: `Error: ${error.message || 'Failed to build fuzz plan.'}`
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const toggleApproval = (planId, url) => {
    setApprovalState((prev) => {
      const current = new Set(prev[planId] || []);
      if (current.has(url)) current.delete(url);
      else current.add(url);
      return { ...prev, [planId]: current };
    });
  };

  const setAllApproved = (planId, all, checked) => {
    setApprovalState((prev) => ({
      ...prev,
      [planId]: checked ? new Set(all) : new Set()
    }));
  };

  /** Optional surface-discovery pass: probe common API prefixes on the plan's
   *  hosts (+ wildcard expansion) to find actual API endpoints before fuzzing.
   *  Any approved endpoints are merged into the plan's candidate list and
   *  auto-approved so the user can launch immediately. */
  const discoverSurface = async (planId) => {
    if (!planId || discoveringPlanId) return;
    setDiscoveringPlanId(planId);
    try {
      const res = await fetch('/api/surface/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, includeHostPatterns: true })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      setSurfaceResults((prev) => ({ ...prev, [planId]: data }));

      if (Array.isArray(data.approvedTargets) && data.approvedTargets.length) {
        setMessages((prev) => prev.map((m) => {
          if (m?.kind === 'plan' && m.plan?.planId === planId) {
            const existing = new Set(m.plan.candidates || []);
            const merged = [...existing];
            for (const u of data.approvedTargets) {
              if (!existing.has(u)) merged.push(u);
            }
            return {
              ...m,
              plan: { ...m.plan, candidates: merged }
            };
          }
          return m;
        }));
        setApprovalState((prev) => {
          const current = new Set(prev[planId] || []);
          for (const u of data.approvedTargets) current.add(u);
          return { ...prev, [planId]: current };
        });
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          model,
          lab: true,
          content: `Surface discovery failed: ${error.message || 'unknown error'}`
        }
      ]);
    } finally {
      setDiscoveringPlanId(null);
    }
  };

  const launchFromPlanWidget = async (planId, candidates) => {
    const approved = [...(approvalState[planId] || new Set())].filter((u) => candidates.includes(u));
    if (approved.length === 0) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          model,
          lab: true,
          content: 'No targets selected. Tick at least one before launching.'
        }
      ]);
      return;
    }
    await runFuzz({
      planId,
      approvedTargets: approved,
      userContent: `/fuzz ${planId} (${approved.length}/${candidates.length} approved)`
    });
  };

  const runFuzz = async ({ planId, approvedTargets, userContent }) => {
    const id = String(planId || '').trim();
    if (!id || loading || !currentId) return;

    const userMessage = { role: 'user', content: userContent || `/fuzz ${id}`, lab: true };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    // Placeholder assistant bubble that we'll append events into.
    const lines = ['## Fuzz run starting', `**Plan:** \`${id}\``, ''];
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', model, lab: true, content: lines.join('\n') }
    ]);
    const pushLine = (text) => {
      lines.push(text);
      setMessages((prev) => {
        const updated = [...prev];
        if (updated.length > 0) {
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            lab: true,
            content: lines.join('\n')
          };
        }
        return updated;
      });
    };

    try {
      // Auth token is NEVER read from state/messages — only from the
      // session-only ref. This keeps it out of saved conversations.
      const authToken = authTokenRef.current || null;
      const res = await fetch('/api/fuzz/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: id,
          approvedTargets: approvedTargets || null,
          authToken
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const rawFindings = [];
      let reviewedFindings = null;
      let summary = null;

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const evs = buffer.split('\n');
        buffer = evs.pop() || '';
        for (const raw of evs) {
          if (!raw.trim()) continue;
          let ev;
          try { ev = JSON.parse(raw); } catch { continue; }
          if (ev.type === 'start') {
            pushLine(`**Probes planned:** ${ev.probeCount} across ${ev.approvedTargets.length} target(s)`);
            pushLine(`**Budget:** ${ev.budget.maxRequests} req, concurrency ${ev.budget.concurrency}, timeout ${ev.budget.timeoutMs}ms`);
            pushLine('');
            pushLine('| probe | target | hypothesis | source | status | size | novelty |');
            pushLine('|---|---|---|---|---|---|---|');
          } else if (ev.type === 'probe') {
            const st = ev.result?.ok ? ev.result.status : `err:${ev.result?.error || '?'}`;
            // Render 0-byte (redirect/empty) responses as em-dash so the UI
            // isn't ambiguous about "0 bytes returned" vs "not counted".
            const szRaw = ev.result?.ok ? ev.result.size : null;
            const sz = szRaw == null ? '-' : szRaw === 0 ? '—' : szRaw;
            const src = ev.probe.source === 'llm' ? 'AI' : 'pattern';
            const tgt = shortTargetLabel(ev.probe.url || ev.probe.target || '');
            pushLine(`| \`${ev.probe.id}\` | \`${tgt}\` | ${ev.probe.hypothesis} | ${src} | ${st} | ${sz} | ${ev.triage.novelty} |`);
            if (ev.triage.findings?.length) {
              for (const f of ev.triage.findings) rawFindings.push({ ...f, url: ev.probe.url });
            }
          } else if (ev.type === 'expand') {
            const addedCount = ev.added?.length || 0;
            const rejectedCount = ev.rejected?.length || 0;
            if (ev.error) {
              pushLine(`_AI expansion errored: ${ev.error}_`);
            } else if (addedCount > 0 || rejectedCount > 0) {
              pushLine(`_AI proposed ${addedCount + rejectedCount} probes; kept ${addedCount}, rejected ${rejectedCount}${rejectedCount > 0 ? ` (reasons: ${[...new Set(ev.rejected.map((r) => r.reason))].join(', ')})` : ''}._`);
            }
          } else if (ev.type === 'review') {
            if (ev.error) {
              pushLine(`_Skeptic review errored: ${ev.error}_`);
            } else if (Array.isArray(ev.findings)) {
              reviewedFindings = ev.findings;
            }
          } else if (ev.type === 'reject') {
            pushLine(`_rejected target: ${ev.target} (${ev.reason})_`);
          } else if (ev.type === 'skip') {
            // Baseline was degenerate (CDN 301, 403 HTML, etc.) — variant dropped
            pushLine(`_skipped ${ev.target}: ${ev.reason}_`);
          } else if (ev.type === 'done') {
            summary = ev.summary;
          } else if (ev.type === 'error') {
            pushLine(`**Error:** ${ev.error}`);
          }
        }
      }

      pushLine('');
      const findings = reviewedFindings || rawFindings;
      if (findings.length) {
        pushLine(`### Findings (${findings.length}${reviewedFindings ? ', Skeptic-reviewed' : ''})`);
        for (const f of findings) {
          const verdictTag = f.verdict ? ` _(${f.verdict})_` : '';
          const sev = f.severity || 'info';
          const origSev = f.originalSeverity && f.originalSeverity !== sev ? ` (was ${f.originalSeverity})` : '';
          pushLine(`- **[${sev}${origSev}] ${f.title}**${verdictTag} — ${f.url}`);
          pushLine(`  - ${f.detail}`);
          if (f.verdictReason) pushLine(`  - _Skeptic:_ ${f.verdictReason}`);
        }
      } else {
        pushLine('_No findings surfaced. Triage is conservative — try increasing scope or adding auth._');
      }
      if (summary) {
        pushLine('');
        const noveltyParts = [
          `${summary.novelty.novel} novel`,
          `${summary.novelty.similar} similar`
        ];
        if (summary.novelty.degenerate) noveltyParts.push(`${summary.novelty.degenerate} degenerate`);
        noveltyParts.push(`${summary.novelty.errors} errors`);
        pushLine(
          `**Done.** ${summary.requests} requests` +
            (summary.llmProposedCount
              ? ` (incl. ${summary.llmProposedCount} AI-proposed)`
              : '') +
            `, ${noveltyParts.join(', ')}.`
        );
        // Per-host breakdown (only shown when we actually have >1 host, to
        // avoid redundancy for single-target runs).
        const perHost = summary.perHost || {};
        const hosts = Object.keys(perHost);
        if (hosts.length > 1) {
          pushLine('');
          pushLine('### Per-host breakdown');
          pushLine('| host | requests | findings | skipped | novel | similar | degenerate | errors |');
          pushLine('|---|---|---|---|---|---|---|---|');
          for (const h of hosts) {
            const r = perHost[h];
            pushLine(`| \`${h}\` | ${r.requests || 0} | ${r.findings || 0} | ${r.skipped || 0} | ${r.novel || 0} | ${r.similar || 0} | ${r.degenerate || 0} | ${r.errors || 0} |`);
          }
        }
        if (Array.isArray(summary.skipped) && summary.skipped.length) {
          pushLine('');
          pushLine(`_Skipped ${summary.skipped.length} target(s) due to degenerate baselines (CDN redirects, HTML 403s, etc.)_`);
        }
      }

      await loadConversations();
    } catch (error) {
      pushLine(`**Error:** ${error.message || 'Fuzz run failed.'}`);
    } finally {
      setLoading(false);
    }
  };

  const totalAttachmentBytes = attachments.reduce((sum, file) => sum + file.size, 0);
  const oversizedFiles = attachments.filter((file) => file.size > MAX_FILE_SIZE_BYTES);
  const tooManyFiles = attachments.length > MAX_FILES;
  const uploadError = tooManyFiles
    ? `Too many files selected (${attachments.length}/${MAX_FILES})`
    : oversizedFiles.length > 0
      ? `File too large: ${oversizedFiles[0].name} (max 25MB each)`
      : '';
  const canSend = Boolean(input.trim()) && !loading && !uploadError;

  const formatMB = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  const copyMessage = async (text, idx) => {
    try {
      await navigator.clipboard.writeText(text || '');
      setCopiedMsgIndex(idx);
      setTimeout(() => setCopiedMsgIndex(null), 1200);
    } catch (error) {
      console.error('Copy failed:', error);
    }
  };

  return (
    <div className="app">
      <div className="sidebar">
        <div className="logo">
          <h1>Cloud Brain</h1>
          <p>Personal AI</p>
        </div>

        <button className="new-chat" onClick={createNew}>
          + New Chat
        </button>

        <div className="conversations">
          <h3>Recent</h3>
          {conversations.length === 0 ? (
            <p className="empty">No conversations yet</p>
          ) : (
            conversations.map((convo) => (
              <div
                key={convo.id}
                className={`conversation ${currentId === convo.id ? 'active' : ''}`}
                onClick={() => loadConversation(convo.id)}
              >
                <div className="convo-info">
                  <p className="convo-title">{convo.title}</p>
                  <p className="convo-meta">{convo.messageCount} messages</p>
                </div>
                <button className="delete-btn" onClick={(e) => deleteConversation(convo.id, e)}>
                  x
                </button>
              </div>
            ))
          )}
        </div>

        <div className="model-guide">
          <h3>Commands</h3>
          <div className="guide-item">
            <p className="guide-name">Paste a URL</p>
            <p className="guide-use">
              Paste-only URLs: HackerOne policy scope pages open a fuzz plan first; other URLs run scope discussion (/scope-style).
            </p>
          </div>
          <div className="guide-item">
            <p className="guide-name">/scope &lt;policy-url&gt;</p>
            <p className="guide-use">Balanced routing: read policy and run multi-AI discussion in chat.</p>
          </div>
          <div className="guide-item">
            <p className="guide-name">/scope-free &lt;policy-url&gt;</p>
            <p className="guide-use">Force free-tier model routing.</p>
          </div>
          <div className="guide-item">
            <p className="guide-name">/scope-premium &lt;policy-url&gt;</p>
            <p className="guide-use">Escalate to premium reasoning routing.</p>
          </div>
          <div className="guide-item">
            <p className="guide-name">/scope-browse &lt;policy-url&gt;</p>
            <p className="guide-use">
              Headless Chromium (Playwright): rendered text + screenshot, merged with a vision model for scope JSON.
            </p>
          </div>
          <div className="guide-item">
            <p className="guide-name">/scope-browse-free / /scope-browse-premium</p>
            <p className="guide-use">Same browse pipeline with free or premium routing.</p>
          </div>
          <div className="guide-item">
            <p className="guide-name">/plan &lt;policy-url&gt;</p>
            <p className="guide-use">
              Extract scope and build a reviewable fuzz plan. Returns a planId; review candidate targets before running.
            </p>
          </div>
          <div className="guide-item">
            <p className="guide-name">/fuzz &lt;planId&gt;</p>
            <p className="guide-use">
              Run the fuzzer against an approved plan (GET probes only, budget-capped, SSRF-guarded). Streams results as they arrive.
            </p>
          </div>
          <div className="guide-item">
            <p className="guide-name">/image &lt;prompt&gt;</p>
            <p className="guide-use">Generate image with selected image model.</p>
          </div>
          <h3>Model Guide</h3>
          {Object.entries(models).map(([key, cfg]) => (
            <div key={key} className={`guide-item ${key === model ? 'active' : ''}`}>
              <p className="guide-name">{cfg.name}</p>
              <p className="guide-use">{modelGuide[key] || cfg.bestFor || 'General use'}</p>
            </div>
          ))}
          <h3>Image Models</h3>
          {Object.entries(imageModels).map(([key, cfg]) => (
            <div key={key} className={`guide-item ${key === imageModel ? 'active' : ''}`}>
              <p className="guide-name">{cfg.name}</p>
              <p className="guide-use">{cfg.bestFor || 'General image generation'}</p>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <button
            type="button"
            className="auth-toggle-btn"
            style={{ marginBottom: '8px', width: '100%' }}
            onClick={() => setShowAuthPanel(true)}
          >
            {authTokenSet ? 'Session auth: set (click to change)' : 'Set session auth token'}
          </button>
          <p>Free models, local history</p>
        </div>
      </div>

      <div className="main">
        {!currentId ? (
          <div className="welcome">
            <h2>Welcome to Cloud Brain</h2>
            <p>Your chat app powered by OpenRouter models.</p>
            <button onClick={createNew} className="start-btn">
              Start New Conversation
            </button>
          </div>
        ) : (
          <>
            <div className="chat-header">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="title-input"
              />
              <div className="workspace-tabs" role="tablist" aria-label="Workspace">
                <button
                  type="button"
                  className={`workspace-tab ${workspaceMode === 'chat' ? 'active' : ''}`}
                  onClick={() => setWorkspaceMode('chat')}
                >
                  Chat
                </button>
                <button
                  type="button"
                  className={`workspace-tab ${workspaceMode === 'lab' ? 'active' : ''}`}
                  onClick={() => setWorkspaceMode('lab')}
                >
                  Scope &amp; fuzz
                </button>
              </div>
              <select value={model} onChange={(e) => setModel(e.target.value)} className="model-select">
                {Object.entries(models).map(([key, cfg]) => (
                  <option key={key} value={key}>
                    {cfg.name} ({cfg.cost})
                  </option>
                ))}
              </select>
            </div>

            {workspaceMode === 'lab' ? (
              <p className="workspace-hint">
                Lab mode hides general chat. Only `/plan`, `/fuzz`, `/scope…`, and pasted policy URLs run
                here — switch to <strong>Chat</strong> for normal LLM conversation.
              </p>
            ) : null}

            <div className="messages">
              {displayMessages.length === 0 ? (
                <div className="empty-messages">
                  <p>
                    {workspaceMode === 'lab'
                      ? 'Run /plan with a policy URL, paste a HackerOne scope link, or use /scope / /fuzz. Switch to Chat for open-ended messages.'
                      : 'Start typing to begin...'}
                  </p>
                </div>
              ) : (
                displayMessages.map((msg, idx) => (
                  <div key={idx} className={`message ${msg.role}`} data-lab={msg.lab ? '1' : undefined}>
                    <div className="message-content">
                      {msg.kind === 'plan' && msg.plan ? (
                        // Render PlanWidget ONLY — no msg.content fallback below,
                        // so we don't get stale-markdown/empty-bullet artifacts
                        // alongside the live widget.
                        <PlanWidget
                          plan={msg.plan}
                          approved={approvalState[msg.plan.planId] || new Set()}
                          onToggle={(url) => toggleApproval(msg.plan.planId, url)}
                          onSelectAll={(checked) =>
                            setAllApproved(msg.plan.planId, msg.plan.candidates, checked)
                          }
                          onLaunch={() => launchFromPlanWidget(msg.plan.planId, msg.plan.candidates)}
                          loading={loading}
                          authTokenSet={authTokenSet}
                          onOpenAuthPanel={() => setShowAuthPanel(true)}
                          onDiscoverSurface={() => discoverSurface(msg.plan.planId)}
                          discovering={discoveringPlanId === msg.plan.planId}
                          surfaceResult={surfaceResults[msg.plan.planId] || null}
                        />
                      ) : (
                        msg.content
                      )}
                      {msg.role === 'assistant' && msg.kind !== 'plan' && (
                        <button
                          type="button"
                          className="copy-btn"
                          onClick={() => copyMessage(msg.content, idx)}
                        >
                          {copiedMsgIndex === idx ? 'Copied' : 'Copy'}
                        </button>
                      )}
                      {msg.role === 'assistant' && msg.model && (
                        <div className="message-model">
                          via {models[msg.model]?.name || imageModels[msg.model]?.name || msg.model}
                          {msg.maxTokens ? ` - max ${msg.maxTokens} tokens` : ''}
                        </div>
                      )}
                      {Array.isArray(msg.imageUrls) &&
                        msg.imageUrls.map((url, imgIdx) => (
                          <img
                            key={`${url}-${imgIdx}`}
                            src={url}
                            alt={`Generated ${imgIdx + 1}`}
                            className="generated-image"
                          />
                        ))}
                    </div>
                  </div>
                ))
              )}
              {loading && (
                <div className="message assistant loading">
                  <div className="message-content">Thinking...</div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form className="input-form" onSubmit={sendMessage}>
              {workspaceMode === 'chat' ? (
                <>
                  <div className="input-actions">
                    <button
                      type="button"
                      className="attach-btn"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={loading}
                    >
                      + Files
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="file-input"
                      onChange={(e) => {
                        const selected = Array.from(e.target.files || []);
                        setAttachments(selected);
                      }}
                    />
                  </div>
                  {attachments.length > 0 && (
                    <div className="attachments">
                      {attachments.map((file) => (
                        <span key={`${file.name}-${file.size}`} className="attachment-chip">
                          {file.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className={`upload-meta ${uploadError ? 'error' : ''}`}>
                    {attachments.length}/{MAX_FILES} files, {formatMB(totalAttachmentBytes)} total
                    {uploadError ? ` - ${uploadError}` : ' - Max 25MB each'}
                  </div>
                  <label className="long-answer-toggle">
                    <input
                      type="checkbox"
                      checked={longAnswerMode}
                      onChange={(e) => setLongAnswerMode(e.target.checked)}
                      disabled={loading}
                    />
                    Long answer mode
                  </label>
                  <label className="long-answer-toggle">
                    <span>Image model</span>
                    <select
                      value={imageModel}
                      onChange={(e) => setImageModel(e.target.value)}
                      disabled={loading}
                      className="image-model-select"
                    >
                      {Object.entries(imageModels).map(([key, cfg]) => (
                        <option key={key} value={key}>
                          {cfg.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  workspaceMode === 'lab'
                    ? '/plan URL · /fuzz plan_… · /scope… · paste policy URL'
                    : 'Type your message... (Auto router can switch models)'
                }
                disabled={loading}
                autoFocus
              />
              <button type="submit" disabled={!canSend}>
                {loading ? '...' : '>'}
              </button>
              {workspaceMode === 'chat' ? (
                <button
                  type="button"
                  onClick={generateImage}
                  disabled={!canSend}
                  className="image-generate-btn"
                >
                  Generate
                </button>
              ) : null}
            </form>
          </>
        )}
      </div>
      <AuthPanel
        open={showAuthPanel}
        currentlySet={authTokenSet}
        onClose={() => setShowAuthPanel(false)}
        onSave={(value) => {
          authTokenRef.current = value;
          setAuthTokenSet(Boolean(value));
          setShowAuthPanel(false);
        }}
        onClear={() => {
          authTokenRef.current = '';
          setAuthTokenSet(false);
          setShowAuthPanel(false);
        }}
      />
    </div>
  );
}
