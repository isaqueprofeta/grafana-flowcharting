/**
 * Feature: angular-to-react-migration — Task 12.1 (openDrawEditor / listenMessage port).
 * Validates: Requirements 6.1, 6.2, 6.3
 *
 * Unit tests for DrawioEditor:
 *   - open() calls window.open with the embed URL (embed params + fc-<uid> + src=grafana).
 *   - the message listener replies to the fc-<uid> ready handshake with the current XML.
 *   - a save message invokes onSave(xml); an exit (empty) message invokes onExit.
 *   - protocol/source identifiers are `fc-<uid>` / `src=grafana`.
 */
import {
  DrawioEditor,
  buildEditorUrl,
  protocolId,
  DEFAULT_EDITOR_URL,
  FC_SOURCE,
  FC_PROTOCOL_PREFIX,
} from './DrawioEditor';

describe('DrawioEditor — buildEditorUrl (Req 6.1, 6.3)', () => {
  it('builds the default embed URL with embed params, fc-<uid> and src=grafana', () => {
    const url = buildEditorUrl({ uid: 'abc123', xml: '<x/>' });
    expect(url.startsWith(`${DEFAULT_EDITOR_URL}?`)).toBe(true);
    expect(url).toContain('embed=1');
    expect(url).toContain('spin=1');
    expect(url).toContain('libraries=1');
    expect(url).toContain('ui=dark');
    expect(url).toContain('ready=fc-abc123');
    expect(url).toContain(`src=${FC_SOURCE}`);
  });

  it('honors a configured editorUrl and editorTheme', () => {
    const url = buildEditorUrl({
      uid: 'u1',
      xml: '',
      editorUrl: 'https://example.com/edit/',
      editorTheme: 'kennedy',
    });
    expect(url.startsWith('https://example.com/edit/?')).toBe(true);
    expect(url).toContain('ui=kennedy');
    expect(url).toContain('ready=fc-u1');
  });

  it('protocolId uses the fc- prefix', () => {
    expect(protocolId('xyz')).toBe(`${FC_PROTOCOL_PREFIX}xyz`);
    expect(protocolId('xyz')).toBe('fc-xyz');
  });
});

describe('DrawioEditor — open() (Req 6.1)', () => {
  let openSpy: jest.SpyInstance;
  let addSpy: jest.SpyInstance;
  let removeSpy: jest.SpyInstance;
  let fakeWindow: { close: jest.Mock };

  beforeEach(() => {
    fakeWindow = { close: jest.fn() };
    openSpy = jest.spyOn(window, 'open').mockReturnValue(fakeWindow as unknown as Window);
    addSpy = jest.spyOn(window, 'addEventListener');
    removeSpy = jest.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens window.open with the correct URL and registers a message listener', () => {
    const editor = new DrawioEditor({ uid: 'uid1', xml: '<diagram/>' });
    const handle = editor.open();

    expect(openSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, target] = openSpy.mock.calls[0];
    expect(calledUrl).toBe(editor.url);
    expect(calledUrl).toContain('ready=fc-uid1');
    expect(calledUrl).toContain('src=grafana');
    expect(target).toBe('MxGraph Editor');

    expect(addSpy).toHaveBeenCalledWith('message', expect.any(Function), false);
    expect(editor.isOpen).toBe(true);
    expect(handle).toBe(fakeWindow);
  });

  it('close() detaches the listener, closes the window and fires onExit', () => {
    const onExit = jest.fn();
    const editor = new DrawioEditor({ uid: 'uid1', xml: '<x/>' }, { onExit });
    editor.open();
    editor.close();

    expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function), false);
    expect(fakeWindow.close).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(editor.isOpen).toBe(false);
  });
});

describe('DrawioEditor — message protocol (Req 6.2, 6.3)', () => {
  beforeEach(() => {
    jest.spyOn(window, 'open').mockReturnValue({ close: jest.fn() } as unknown as Window);
    jest.spyOn(window, 'addEventListener').mockImplementation(() => undefined);
    jest.spyOn(window, 'removeEventListener').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('replies to the fc-<uid> ready handshake by posting the current XML to the source', () => {
    const xml = '<mxGraphModel><root/></mxGraphModel>';
    const editor = new DrawioEditor({ uid: 'readyUid', xml });
    editor.open();

    const post = jest.fn();
    editor.handleMessage({
      data: 'fc-readyUid',
      origin: 'https://embed.diagrams.net',
      source: { postMessage: post },
    });

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(xml, 'https://embed.diagrams.net');
  });

  it('ignores a handshake for a different uid', () => {
    const editor = new DrawioEditor({ uid: 'mine', xml: '<x/>' });
    editor.open();

    const post = jest.fn();
    editor.handleMessage({
      data: 'fc-someoneelse',
      origin: 'https://embed.diagrams.net',
      source: { postMessage: post },
    });

    expect(post).not.toHaveBeenCalled();
  });

  it('invokes onSave with the saved XML after the handshake', () => {
    const onSave = jest.fn();
    const editor = new DrawioEditor({ uid: 'saveUid', xml: '<old/>' }, { onSave });
    editor.open();

    // 1. ready handshake (so `posted` is set)
    editor.handleMessage({
      data: 'fc-saveUid',
      origin: 'https://embed.diagrams.net',
      source: { postMessage: jest.fn() },
    });

    // 2. save message carrying the new XML
    const newXml = '<mxGraphModel><root><new/></root></mxGraphModel>';
    editor.handleMessage({ data: newXml, origin: 'https://embed.diagrams.net' });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(newXml);
  });

  it('does not invoke onSave before the ready handshake', () => {
    const onSave = jest.fn();
    const editor = new DrawioEditor({ uid: 'u', xml: '<x/>' }, { onSave });
    editor.open();

    editor.handleMessage({ data: '<unexpected/>', origin: 'https://embed.diagrams.net' });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('invokes onExit and tears down on an empty payload', () => {
    const onExit = jest.fn();
    const editor = new DrawioEditor({ uid: 'exitUid', xml: '<x/>' }, { onExit });
    editor.open();

    editor.handleMessage({ data: '', origin: 'https://embed.diagrams.net' });

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(editor.isOpen).toBe(false);
  });

  it('setXml updates the payload sent on a subsequent handshake', () => {
    const editor = new DrawioEditor({ uid: 'u', xml: '<first/>' });
    editor.open();
    editor.setXml('<second/>');

    const post = jest.fn();
    editor.handleMessage({
      data: 'fc-u',
      origin: 'https://embed.diagrams.net',
      source: { postMessage: post },
    });

    expect(post).toHaveBeenCalledWith('<second/>', 'https://embed.diagrams.net');
  });
});
