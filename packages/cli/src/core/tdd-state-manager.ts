import { TDDState } from './reminder-types.js';
import * as reminders from './reminder-factory.js';

type TestStatus = 'success' | 'error';

export class TDDStateManager {
  private currentState: TDDState = TDDState.EXPLORING;
  private modifiedFiles: Set<string> = new Set();

  public getState(): TDDState {
    return this.currentState;
  }
  public getModifiedFiles(): Set<string> {
    return this.modifiedFiles;
  }

  public handleModification(fileName: string): void {
    this.modifiedFiles.add(fileName);

    // Use numerical comparison to manage progression
    if (this.currentState < TDDState.WRITING_TEST) {
      // Assume the first modification is the test case
      this.currentState = TDDState.WRITING_TEST;
    } else if (this.currentState === TDDState.REPRO_FAILED) {
      // Assume modification after reproduction is the fix
      this.currentState = TDDState.WRITING_FIX;
    }
    // (Modifications during WRITING_TEST/WRITING_FIX/CLEANUP keep the current state)
  }

  public handleTestResult(status: TestStatus): string[] {
    const reminderList: string[] = [];
    let nextState = this.currentState;

    if (status === 'error') {
      // Tests FAILED
      if (this.currentState <= TDDState.WRITING_TEST) {
        // Expected failure: Bug reproduced (RED)
        nextState = TDDState.REPRO_FAILED;
        reminderList.push(
          reminders.formatReminder(
            'CHECKPOINT: Bug Reproduced (RED)',
            'Tests failed as expected. Proceed to WRITING_FIX.',
          ),
        );
      } else {
        // Unexpected failure: Fix is incomplete or caused regression
        nextState = TDDState.WRITING_FIX;
        // The main CIM error handler will provide the traceback; here we just ensure the state is correct.
      }
    } else {
      // Tests PASSED
      if (this.currentState <= TDDState.WRITING_TEST) {
        // CRITICAL TDD VIOLATION: Passed before reproduction
        nextState = TDDState.WRITING_TEST; // Force back
        reminderList.push(
          reminders.formatReminder(
            'TDD VIOLATION: Premature Passing Tests',
            'Tests passed BEFORE bug reproduction. You MUST write a test that FAILS first. Review your test case immediately.',
          ),
        );
      } else if (this.currentState >= TDDState.WRITING_FIX) {
        // Expected pass: Fix verified (GREEN)
        nextState = TDDState.FIX_VERIFIED;
        reminderList.push(
          reminders.formatReminder(
            'CHECKPOINT: Fix Verified (GREEN)',
            'Proceed to the CLEANUP phase.',
          ),
        );
      }
    }

    // Handle regressions during cleanup specifically
    if (this.currentState === TDDState.CLEANUP && status === 'error') {
      nextState = TDDState.WRITING_FIX;
      reminderList.push(
        reminders.formatReminder(
          'CRITICAL: Regression During Cleanup',
          'Tests failed after cleanup modifications. You have broken the fix. Return to WRITING_FIX immediately.',
        ),
      );
    }

    this.currentState = nextState;
    return reminderList;
  }
}
