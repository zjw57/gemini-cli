import { TDDState } from './reminder-types.js';
import { cimConfig } from './cim.config.js';

interface ActionLog {
  command: string;
  target: string;
}

export class StagnationDetector {
  private actionHistory: ActionLog[] = [];
  private currentTurnsInState = 0;
  private currentState: TDDState = TDDState.EXPLORING;

  public logAction(command: string, target: string): void {
    this.actionHistory.push({ command, target });
    if (this.actionHistory.length > cimConfig.stagnation.historyBufferSize) {
      this.actionHistory.shift();
    }
  }

  public detectStagnation(newState: TDDState): string | null {
    this._updateStateTracking(newState);

    // Check 1: Immediate Repetition Loop
    const repetitionWarning = this._checkImmediateRepetition();
    if (repetitionWarning) return repetitionWarning;

    // Check 2: Repetitive Reads
    const readWarning = this._checkRepetitiveReads();
    if (readWarning) return readWarning;

    // Check 3: State Timeouts
    const timeoutWarning = this._checkStateTimeouts();
    if (timeoutWarning) return timeoutWarning;

    return null;
  }

  private _updateStateTracking(newState: TDDState): void {
    if (this.currentState === newState) {
      this.currentTurnsInState++;
    } else {
      this.currentState = newState;
      this.currentTurnsInState = 1;
    }
  }

  private _checkImmediateRepetition(): string | null {
    const threshold = cimConfig.stagnation.immediateRepetitionLimit;
    if (this.actionHistory.length < threshold) return null;

    const recentActions = this.actionHistory.slice(-threshold);
    const lastAction = recentActions[recentActions.length - 1];

    const isLoop = recentActions.every(
      (action) =>
        action.command === lastAction.command &&
        action.target === lastAction.target,
    );

    if (isLoop) {
      return `Repetitive action detected: "${lastAction.command}" executed ${threshold} times consecutively. You MUST change your strategy. Do not repeat this command.`;
    }
    return null;
  }

  private _checkRepetitiveReads(): string | null {
    const threshold = cimConfig.stagnation.repetitiveReadLimit;
    const readActions = this.actionHistory.filter(
      (a) =>
        a.command === 'read_file' ||
        (a.command === 'run_shell_command' && a.target.startsWith('cat')),
    );

    const counts: Record<string, number> = {};
    for (const action of readActions) {
      counts[action.target] = (counts[action.target] || 0) + 1;
      if (counts[action.target] >= threshold) {
        return `Excessive reading detected: File '${action.target}' read ${counts[action.target]} times recently. Stop re-reading and start analyzing the information you have (trace imports, find usages) or transition to modification.`;
      }
    }
    return null;
  }

  private _checkStateTimeouts(): string | null {
    const timeouts = cimConfig.stagnation.stateTimeouts;
    const timeout = timeouts[this.currentState as keyof typeof timeouts];

    if (timeout && this.currentTurnsInState > timeout) {
      if (this.currentState === TDDState.EXPLORING) {
        return `Excessive time spent exploring (${this.currentTurnsInState} turns). Stop exploring and transition to WRITING_TEST based on your current findings NOW.`;
      }
      if (this.currentState === TDDState.WRITING_TEST) {
        return `Excessive time spent writing a test (${this.currentTurnsInState} turns). The test should be minimal. If you are blocked, try a different approach to reproduce the bug.`;
      }
      if (this.currentState === TDDState.WRITING_FIX) {
        return `Excessive time spent writing a fix (${this.currentTurnsInState} turns). The fix should be minimal. If you are blocked, reconsider your understanding of the bug.`;
      }
    }
    return null;
  }
}
