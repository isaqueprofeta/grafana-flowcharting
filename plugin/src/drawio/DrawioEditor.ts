/**
 * DrawioEditor — React-migration port of the legacy draw.io authoring popup
 * (`openDrawEditor` / `listenMessage` from `src/flowchart_handler.ts`).
 *
 * This is a framework-agnostic seam: it owns the `window.open` to the configured
 * `embed.diagrams.net` editor (Requirement 6.1) and the `postMessage` protocol
 * (Requirement 6.2) using the identifier `fc-<uid>` and `src=grafana`
 * (Requirement 6.3). It exposes clean callback seams — `onSave(xml)` and
 * `onExit()` — so Task 12.2 can wire a saved diagram back into the panel options
 * via `onOptionsChange` without this module knowing anything about React or
 * Grafana options.
 *
 * No `eval`, no global mutation: all state is instance-scoped, the message
 * listener is attached/detached on the instance, and the editor window handle is
 * held privately.
 *
 * Legacy protocol (preserved):
 *   1. The editor is opened with `?embed=1&spin=1&libraries=1&ui=<theme>&ready=fc-<uid>&src=grafana`.
 *   2. The editor posts back `fc-<uid>` when it is ready; we reply by posting the
 *      current Diagram_XML string to the editor window.
 *   3. On save, the editor posts the resulting Diagram_XML string back; we invoke
 *      `onSave(xml)`.
 *   4. On exit (empty payload), we invoke `onExit()`, detach the listener, and
 *      close the editor window.
 */

export type DioTheme = 'dark' | 'kennedy' | 'minimal' | 'atlas';

/** The protocol prefix used to tag our messages to/from the editor (Req 6.3). */
export const FC_PROTOCOL_PREFIX = 'fc-';

/** The source identifier appended to the editor URL (Req 6.3). */
export const FC_SOURCE = 'grafana';

/** The default embed editor URL (matches `defaultEditorOptions.editorUrl`). */
export const DEFAULT_EDITOR_URL = 'https://embed.diagrams.net/';

export interface DrawioEditorConfig {
  /** Stable unique id for this editor session; forms the `fc-<uid>` protocol id. */
  uid: string;
  /** The current Diagram_XML to seed the editor with (sent on the ready handshake). */
  xml: string;
  /** Configured editor URL; defaults to `https://embed.diagrams.net/`. */
  editorUrl?: string;
  /** Configured editor theme (maps to the draw.io `ui` param). */
  editorTheme?: DioTheme;
}

export interface DrawioEditorCallbacks {
  /** Invoked with the resulting Diagram_XML when the user saves in the editor. */
  onSave?: (xml: string) => void;
  /** Invoked when the editor is exited/closed. */
  onExit?: () => void;
}

/**
 * Minimal structural subset of `MessageEvent` this module relies on. Kept
 * narrow so it can be exercised in tests without constructing full DOM events.
 */
export interface DrawioMessageEvent {
  data: unknown;
  origin: string;
  source?: unknown;
}

/** The structural subset of a message source we post replies to. */
interface PostableSource {
  postMessage: (message: unknown, targetOrigin: string) => void;
}

/** Narrow an unknown message source to one we can post back to. */
function asPostableSource(source: unknown): PostableSource | null {
  if (source != null && typeof (source as PostableSource).postMessage === 'function') {
    return source as PostableSource;
  }
  return null;
}

/** The `fc-<uid>` protocol identifier for a given uid. */
export function protocolId(uid: string): string {
  return `${FC_PROTOCOL_PREFIX}${uid}`;
}

/**
 * Build the editor URL with the embed query params, mirroring the legacy
 * `openDrawEditor` string exactly:
 *   `<editorUrl>?embed=1&spin=1&libraries=1&ui=<theme>&ready=fc-<uid>&src=grafana`
 */
export function buildEditorUrl(config: DrawioEditorConfig): string {
  const base = config.editorUrl && config.editorUrl.length > 0 ? config.editorUrl : DEFAULT_EDITOR_URL;
  const theme = config.editorTheme ?? 'dark';
  const params = [
    'embed=1',
    'spin=1',
    'libraries=1',
    `ui=${encodeURIComponent(theme)}`,
    `ready=${protocolId(config.uid)}`,
    `src=${FC_SOURCE}`,
  ].join('&');
  return `${base}?${params}`;
}

export class DrawioEditor {
  private readonly uid: string;
  private xml: string;
  private readonly editorUrl: string;
  private readonly editorTheme: DioTheme;
  private readonly callbacks: DrawioEditorCallbacks;

  private editorWindow: Window | null = null;
  private onEdit = false;
  private posted = false;
  private readonly boundListener: (event: MessageEvent) => void;

  constructor(config: DrawioEditorConfig, callbacks: DrawioEditorCallbacks = {}) {
    this.uid = config.uid;
    this.xml = config.xml ?? '';
    this.editorUrl = config.editorUrl && config.editorUrl.length > 0 ? config.editorUrl : DEFAULT_EDITOR_URL;
    this.editorTheme = config.editorTheme ?? 'dark';
    this.callbacks = callbacks;
    // Bind once so add/removeEventListener operate on the same reference.
    this.boundListener = (event: MessageEvent) => this.handleMessage(event);
  }

  /** The `fc-<uid>` protocol id for this editor session. */
  get protocol(): string {
    return protocolId(this.uid);
  }

  /** The fully-formed embed editor URL (Req 6.1). */
  get url(): string {
    return buildEditorUrl({
      uid: this.uid,
      xml: this.xml,
      editorUrl: this.editorUrl,
      editorTheme: this.editorTheme,
    });
  }

  /** Whether an editor session is currently open. */
  get isOpen(): boolean {
    return this.onEdit;
  }

  /**
   * Open the draw.io editor popup and begin listening for messages (Req 6.1, 6.2).
   * Returns the opened window handle (or null if the browser blocked it).
   */
  open(): Window | null {
    this.editorWindow = window.open(this.url, 'MxGraph Editor', 'width=1280, height=720');
    this.onEdit = true;
    this.posted = false;
    window.addEventListener('message', this.boundListener, false);
    return this.editorWindow;
  }

  /**
   * Handle an incoming message from the editor window (Req 6.2, 6.3).
   *
   * Protocol:
   *   - `fc-<uid>` (ready handshake): reply by posting the current Diagram_XML.
   *   - non-empty payload that is not the handshake: a save — invoke `onSave`.
   *   - empty payload (or any exit signal while editing): close — invoke `onExit`.
   *
   * Exposed (non-private) so callers/tests can drive the protocol directly.
   */
  handleMessage(event: DrawioMessageEvent): void {
    const data = event.data;
    const isString = typeof data === 'string';

    // Ready handshake: the editor echoes our `fc-<uid>` protocol id. Reply with
    // the current Diagram_XML so the editor loads it (Req 6.2, 6.3).
    if (isString && (data as string).length > 0 && (data as string).startsWith(FC_PROTOCOL_PREFIX)) {
      const postable = asPostableSource(event.source);
      if ((data as string) === this.protocol && postable) {
        postable.postMessage(this.xml, event.origin);
        this.posted = true;
      }
      return;
    }

    if (!this.onEdit) {
      return;
    }

    // Save: a non-empty payload that is not the handshake, received after we
    // posted the seed XML. Flow the saved XML out through onSave (Req 6.4 seam).
    if (isString && (data as string).length > 0 && this.posted) {
      const savedXml = data as string;
      this.xml = savedXml;
      this.callbacks.onSave?.(savedXml);
    }

    // Exit: an empty payload signals the editor closed. Tear down and notify.
    if (!isString || (data as string).length === 0) {
      this.close();
    }
  }

  /**
   * Update the Diagram_XML the editor will be seeded with on the next ready
   * handshake (used when the panel options change while the editor is closed).
   */
  setXml(xml: string): void {
    this.xml = xml ?? '';
  }

  /**
   * Close the editor session: detach the listener, close the window, reset
   * state, and invoke `onExit`. Safe to call multiple times.
   */
  close(): void {
    if (!this.onEdit && this.editorWindow == null) {
      return;
    }
    window.removeEventListener('message', this.boundListener, false);
    if (this.editorWindow) {
      try {
        this.editorWindow.close();
      } catch {
        // Ignore: the window may already be closed by the user.
      }
      this.editorWindow = null;
    }
    const wasEditing = this.onEdit;
    this.onEdit = false;
    this.posted = false;
    if (wasEditing) {
      this.callbacks.onExit?.();
    }
  }
}
