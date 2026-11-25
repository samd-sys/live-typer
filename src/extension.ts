import * as vscode from 'vscode';
import { keyboard, mouse, Key, straightTo, Point } from '@nut-tree-fork/nut-js';

type TypistState = 'normal' | 'slow_motion' | 'burst';

/* ============================================================
   HARDWARE TYPER ENGINE (NUT-JS)
   ============================================================ */
class HardwareTyper {
    private readonly baseWpm: number;
    private readonly variance: number;
    private readonly errorRate: number;
    private currentState: TypistState = 'normal';
    private stateCharCount = 0;

    constructor(options: { wpm: number; variance: number; errorRate: number }) {
        this.baseWpm = options.wpm;
        this.variance = options.variance;
        this.errorRate = options.errorRate;
        keyboard.config.autoDelayMs = 0;
    }

    private updateTypingState() {
        this.stateCharCount++;
        if (this.stateCharCount > (30 + Math.random() * 30)) {
            const roll = Math.random();
            if (roll < 0.20) {
                this.currentState = 'slow_motion';
            } else if (roll < 0.45) {
                this.currentState = 'burst';
            } else {
                this.currentState = 'normal';
            }
            this.stateCharCount = 0;
        }
    }

    getDelay(char: string, prevChar: string): number {
        this.updateTypingState();

        const meanInterval = 60000 / (this.baseWpm * 5); 
        const sigma = this.variance;
        const mu = Math.log(meanInterval) - (sigma * sigma) / 2;

        const u1 = Math.random();
        const u2 = Math.random();
        const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        
        let delay = Math.exp(mu + sigma * z);

        if (this.currentState === 'slow_motion') {
            delay *= 1.8;
        } else if (this.currentState === 'burst') {
            delay *= 0.65;
        }

        if (/[~`!@#$%^&*()_\-+=\[\]{}|\\:;"'<>,.?\/]/.test(char)) delay *= 1.8;
        if ('(){}[]<>'.includes(char)) delay *= 2.2;
        if (char === '\n') delay *= 3.5;
        if (prevChar === ' ' || prevChar === '\t') delay *= 1.1;

        return Math.max(35, Math.min(delay, 2000));
    }

    async typeChar(char: string): Promise<void> {
        if (char === '\n') {
            await keyboard.pressKey(Key.Return);
            await keyboard.releaseKey(Key.Return);
            return;
        }
        if (char === '\t') {
            await keyboard.pressKey(Key.Tab);
            await keyboard.releaseKey(Key.Tab);
            return;
        }
        await keyboard.type(char);
    }

    async maybeInjectTypo(editor: vscode.TextEditor, char: string): Promise<boolean> {
        if (this.errorRate === 0 || Math.random() > this.errorRate) return false;
        if (!/[a-zA-Z0-9]/.test(char)) return false;

        const wrongCharCode = char.charCodeAt(0) + (Math.random() > 0.5 ? 1 : -1);
        const wrongChar = String.fromCharCode(wrongCharCode);
        
        await keyboard.type(wrongChar);
        await new Promise(r => setTimeout(r, 80 + Math.random() * 100));

        await keyboard.pressKey(Key.Backspace);
        await keyboard.releaseKey(Key.Backspace);
        await new Promise(r => setTimeout(r, 100 + Math.random() * 100));

        return true; 
    }

    async humanJiggleMouse(): Promise<void> {
        const currentPos = await mouse.getPosition();
        const targetX = currentPos.x + (Math.random() * 40 - 20);
        const targetY = currentPos.y + (Math.random() * 40 - 20);
        
        mouse.config.mouseSpeed = 500;
        await mouse.move(straightTo(new Point(targetX, targetY)));
    }
}

// Global Control State
let isPaused = false;
let isStopped = false;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);

    const setTypingContext = (active: boolean) => {
        vscode.commands.executeCommand('setContext', 'livetyper:isTyping', active);
    };

    // Global Interrupt Sleep Tracker
    const responsiveSleep = async (ms: number): Promise<boolean> => {
        let elapsed = 0;
        const slice = 50; 
        while (elapsed < ms) {
            if (isStopped) return true;
            while (isPaused && !isStopped) {
                updateStatusBar(true, true);
                await new Promise(r => setTimeout(r, slice));
            }
            if (isStopped) return true;
            await new Promise(r => setTimeout(r, Math.min(slice, ms - elapsed)));
            elapsed += slice;
        }
        return false;
    };

    // Helper: Selects and smoothly scrolls an alternative file
    const reviewWorkspaceFile = async (): Promise<boolean> => {
        const workspaceFiles = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
        if (workspaceFiles.length === 0) return false;

        try {
            const randomUri = workspaceFiles[Math.floor(Math.random() * workspaceFiles.length)];
            const doc = await vscode.workspace.openTextDocument(randomUri);
            const randomEditor = await vscode.window.showTextDocument(doc);

            // Simulate slow scroll down
            const totalLines = doc.lineCount;
            const scrollSteps = Math.min(5, Math.floor(totalLines / 3));
            
            for (let step = 1; step <= scrollSteps; step++) {
                if (isStopped) return true;
                const lineToShow = Math.floor((totalLines / scrollSteps) * step);
                const pos = new vscode.Position(lineToShow, 0);
                
                await randomEditor.revealRange(
                    new vscode.Range(pos, pos),
                    vscode.TextEditorRevealType.InCenter
                );
                if (await responsiveSleep(1500 + Math.random() * 1500)) return true; // Human reading delay
            }
        } catch (err) {}
        return false;
    };

    // Helper: Safely creates a new workspace file
    const createNewFile = async (fileName: string): Promise<vscode.TextEditor | undefined> => {
        let doc: vscode.TextDocument;
        if (vscode.workspace.workspaceFolders && fileName.trim() !== '') {
            const workspaceFolder = vscode.workspace.workspaceFolders[0].uri;
            const fileUri = vscode.Uri.joinPath(workspaceFolder, fileName);
            await vscode.workspace.fs.writeFile(fileUri, new Uint8Array());
            doc = await vscode.workspace.openTextDocument(fileUri);
        } else {
            doc = await vscode.workspace.openTextDocument({ language: 'plaintext' });
        }
        return await vscode.window.showTextDocument(doc);
    };

    // --- SHARED TYPING LOOP ---
    const runTypingFlow = async (editor: vscode.TextEditor, textToType: string) => {
        const config = vscode.workspace.getConfiguration('livetyper');
        const wpm = config.get<number>('wpm', 55);
        const variance = config.get<number>('variance', 0.35);
        const errorRate = config.get<number>('errorRate', 0.015);
        const testMode = config.get<boolean>('testMode', false);
        const workMinutes = config.get<number>('workDurationMinutes', 15);
        const breakMinutes = config.get<number>('breakDurationMinutes', 3);

        const typer = new HardwareTyper({ wpm, variance, errorRate });

        const workDuration = testMode ? workMinutes * 1000 : workMinutes * 60 * 1000;
        const breakLength = testMode ? breakMinutes * 1000 : breakMinutes * 60 * 1000;

        let lastBreakTime = Date.now();

        await typer.humanJiggleMouse();
        if (await responsiveSleep(300)) return;

        let i = 0;
        while (i < textToType.length) {
            if (isStopped) break;

            while (isPaused && !isStopped) {
                updateStatusBar(true, true);
                if (await responsiveSleep(100)) break;
            }
            if (isStopped) break;

            // Optional scheduled break checks
            const timeSinceLastBreak = Date.now() - lastBreakTime;
            if (timeSinceLastBreak >= workDuration) {
                const originalUri = editor.document.uri;
                const originalSelection = editor.selection;

                if (await reviewWorkspaceFile()) break;
                if (await responsiveSleep(breakLength)) break;

                const origDoc = await vscode.workspace.openTextDocument(originalUri);
                const restoredEditor = await vscode.window.showTextDocument(origDoc);
                restoredEditor.selection = originalSelection;
                await restoredEditor.revealRange(originalSelection, vscode.TextEditorRevealType.InCenter);
                
                if (await responsiveSleep(2000)) break;
                lastBreakTime = Date.now();
            }

            const char = textToType[i];
            const prevChar = i > 0 ? textToType[i - 1] : ' ';

            if (await typer.maybeInjectTypo(editor, char)) {
                continue; 
            }

            await typer.typeChar(char);

            try {
                const pos = editor.selection.active;
                await editor.revealRange(
                    new vscode.Range(pos, pos), 
                    vscode.TextEditorRevealType.InCenterIfOutsideViewport
                );
            } catch (e) {}

            if ((char === ';' || char === '}' || char === '\n') && Math.random() < 0.25) {
                if (await responsiveSleep(800 + Math.random() * 1200)) break;
            }

            const delay = typer.getDelay(char, prevChar);
            if (await responsiveSleep(delay)) break;

            i++;
        }
    };

    // --- MAIN F9 COMMAND ENTRY POINT ---
    const startCmd = vscode.commands.registerCommand('livetyper.typeLive', async () => {
        let rawText = await vscode.env.clipboard.readText();
        if (!rawText) {
            vscode.window.showWarningMessage('⚠️ Clipboard is empty!');
            return;
        }
        const textToType = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // Present Option 2 Menu
        const selected = await vscode.window.showQuickPick([
            { label: '📝 Only Type Clipboard', description: 'Start typing into the current file immediately.' },
            { label: '🔄 Coder\'s Loop', description: 'Reference another file first → Create new file → Type clipboard.' },
            { label: '🔍 Only Scroll Reference', description: 'Open a random file and scroll through it slowly.' }
        ], { placeHolder: 'Select your typing action...' });

        if (!selected) return;

        isPaused = false;
        isStopped = false;
        updateStatusBar(true, false);
        setTypingContext(true);

        // SEQUENCE 1: Coder's Loop (Review -> Create -> Type)
        if (selected.label === '🔄 Coder\'s Loop') {
            const fileName = await vscode.window.showInputBox({
                prompt: 'Enter name of file to create for typing (e.g., script.py)',
                placeHolder: 'demo.js'
            });
            if (fileName === undefined) {
                setTypingContext(false);
                return;
            }

            // Step 1: Browse/Scroll a random existing file
            if (await reviewWorkspaceFile()) {
                setTypingContext(false);
                statusBarItem.hide();
                return;
            }

            // Step 2: Create file and switch to it
            const newEditor = await createNewFile(fileName);
            if (!newEditor) {
                setTypingContext(false);
                statusBarItem.hide();
                return;
            }
            if (await responsiveSleep(1500)) {
                setTypingContext(false);
                statusBarItem.hide();
                return;
            }

            // Step 3: Run Live Typing Loop
            await runTypingFlow(newEditor, textToType);

        } else if (selected.label === '📝 Only Type Clipboard') {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showInformationMessage('❌ Open a text file first!');
                setTypingContext(false);
                statusBarItem.hide();
                return;
            }
            await runTypingFlow(editor, textToType);

        } else if (selected.label === '🔍 Only Scroll Reference') {
            await reviewWorkspaceFile();
        }

        statusBarItem.hide();
        setTypingContext(false);
    });

    // --- PAUSE & STOP COMMANDS ---
    const pauseCmd = vscode.commands.registerCommand('livetyper.togglePause', () => {
        isPaused = !isPaused;
        updateStatusBar(true, isPaused);
    });

    const stopCmd = vscode.commands.registerCommand('livetyper.stopLive', () => {
        isStopped = true;
        isPaused = false;
        statusBarItem.hide();
        setTypingContext(false);
    });

    context.subscriptions.push(startCmd, pauseCmd, stopCmd);
}

function updateStatusBar(isRunning: boolean, paused: boolean) {
    if (!isRunning) {
        statusBarItem.hide();
        return;
    }
    if (paused) {
        statusBarItem.text = `$(play) Resume (Press F12)`;
        statusBarItem.command = 'livetyper.togglePause';
    } else {
        statusBarItem.text = `$(debug-pause) Pause (Press F12)`;
        statusBarItem.command = 'livetyper.togglePause';
    }
    statusBarItem.show();
}

export function deactivate() {
    if (statusBarItem) statusBarItem.dispose();
    vscode.commands.executeCommand('setContext', 'livetyper:isTyping', false);
}