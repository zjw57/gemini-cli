#!/usr/bin/env python3
"""
Gemini-CLI Multiturn Eval Framework

This script runs a given prompt against the Gemini CLI multiple times
to evaluate the success rate of tool calls and self-correction.
"""

import subprocess
import json
import os
import uuid
import argparse
from collections import defaultdict
from tqdm import tqdm
from typing import Dict, Any, Optional, List, Tuple, Union
from concurrent.futures import ThreadPoolExecutor, as_completed
from jsonpath_ng import parse as jsonpath_parse
from rich.console import Console
from rich.table import Table
from rich.style import Style
from rich import box
from statsmodels.stats.proportion import proportion_confint

# Relative path from this script to the bundled gemini CLI
GEMINI_CLI_PATH: str = os.path.join(os.path.dirname(__file__), '..', 'bundle', 'gemini.js')


def get_json_path_value(
    data: Dict[str, Any],
    expression: str,
    default: Optional[Any] = None
) -> Optional[Any]:
    """Finds and returns the first value in a JSON object matching a JSONPath expression.

    Args:
        data: The JSON object (as a Python dictionary) to search.
        expression: The JSONPath expression string.
        default: The value to return if no match is found.

    Returns:
        The first value found that matches the expression, or the default value if
        no matches are found.
    """
    jsonpath_expression = jsonpath_parse(expression)
    matches = [match.value for match in jsonpath_expression.find(data)]
    return matches[0] if matches else default


def safe_divide(
    numerator: float,
    denominator: float
) -> float:
    """Performs division, returning 0.0 if the denominator is zero.

    Args:
        numerator: The number to be divided.
        denominator: The number to divide by.

    Returns:
        The result of the division, or 0.0 if the denominator is 0.
    """
    return numerator / denominator if denominator else 0.0


# Times out after 10m by default
def run_gemini_cli(
    prompt: str = 'hello world!',
    timeout: int = 600,
    summary_directory: str = 'tmp',
) -> Optional[Dict[str, Any]]:
    """Invokes the gemini-cli with a given prompt and returns the summary JSON.

    This function constructs and runs a command to execute the Gemini CLI in a
    subprocess. It captures the output and saves a session summary to a file,
    which is then read and returned.

    Args:
        prompt: The prompt to send to the Gemini CLI.
        timeout: The timeout in seconds for the subprocess call.
        summary_directory: The directory where the session summary JSON file will be saved.

    Returns:
        A dictionary containing the parsed JSON from the session summary file,
        or None if an error (e.g., timeout, file not found, JSON error) occurs.
    """
    os.makedirs(summary_directory, exist_ok=True)
    summary_path = os.path.join(summary_directory, f'summary_{uuid.uuid4()}.json')

    command: list[str] = [
        'node', # Alternatively comment out this line and GEMINI_CLI_PATH and replace with the path returned by 'which gemini' to eval the installed version.
        GEMINI_CLI_PATH,
        # '/usr/local/bin/gemini',
        '--yolo',
        '--prompt',
        prompt,
        '--session-summary',
        summary_path
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, text=True, timeout=timeout)
        with open(summary_path, 'r') as f:
            return json.load(f)
    except subprocess.CalledProcessError as e:
        print(f"An error occurred during a run: {e}")
        print(f"Stderr from gemini cli:\n{e.stderr}")
        return None
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"An error occurred during a run: {e}")
        return None
    except subprocess.TimeoutExpired as e:
        print(f"An timeout occurred during a run: {e}")
        return None


def p_of_x_given_y(
    x_path: str,
    y_path: str,
    prompt: str,
    summary_directory: str,
    y_occurrences_target: int = 20,
    max_workers: int = 4,
    max_runs: int = 200,
    timeout: int = 60,
) -> Dict[str, int]:
    """Calculates the count of a successful outcomes (x) given an initial state (y).

    This function repeatedly runs the Gemini CLI in parallel to gather statistics.
    It stops when either the target number of initial states (y_occurrences_target)
    is observed or the maximum number of runs (max_runs) is completed.

    A state (x or y) is considered to have occured if the counter at its
    respective path contains a value greater than 0.

    Note: The primary use case of this function is to measure the ability for
    Gemini CLI self-correct from a bad state (y_path) to a good state (x_path),
    such as "When Gemini CLI trys to call a tool and initially fails, how often
    does it self-correct and end up successfully calling the tool?"

    Note: Given that the initial state (y) can be hard to reproduce, this
    function allows you to set a target on the intended number of preproductions
    as well as the maximum number of runs - and then exit when either condition
    is met.

    Args:
        x_path: The JSONPath to a metric indicating the successful outcome.
        y_path: The JSONPath to a metric indicating the initial state occurred.
        prompt: The prompt to use for each CLI run.
        summary_directory: The directory to store summary files for the runs.
        y_occurrences_target: The target number of times the initial state (y)
            should be observed before stopping the evaluation.
        max_workers: The maximum number of parallel threads to use.
        max_runs: The absolute maximum number of CLI runs to execute.
        timeout: The timeout in seconds for each individual CLI run.

    Returns:
        A dictionary containing the raw counts for 'successes' (x given y),
        'total' (occurrences of y), and total 'runs' performed.
    """
    total_runs: int = 0
    y_occurrences: int = 0
    x_given_y_occurrences: int = 0

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(
          run_gemini_cli,
          prompt=prompt,
          timeout=timeout,
          summary_directory=summary_directory,
          ) for _ in range(max_runs)]

        with tqdm(total=max_runs, desc="CLI Runs") as pbar:
            for future in as_completed(futures):
                pbar.update(1)

                if y_occurrences >= y_occurrences_target:
                    pbar.n = pbar.total
                    for f in futures:
                        if not f.done():
                            f.cancel()
                    break

                try:
                    r = future.result()
                except Exception:
                    continue

                total_runs += 1
                if r is None:
                    continue

                repro_count = get_json_path_value(r, y_path, default=0)
                if repro_count > 0:
                    y_occurrences += 1
                    correction_count = get_json_path_value(r, x_path, default=0)
                    if correction_count > 0:
                        x_given_y_occurrences += 1

    return {
        'successes': x_given_y_occurrences,
        'total': y_occurrences,
        'runs': total_runs,
    }


def _format_row_data(successes: int, total: int, is_group: bool = False) -> Tuple[str, str]:
    """Helper to format percentage and confidence interval strings for a rich table row.

    Args:
        successes: The number of successful outcomes.
        total: The total number of trials.
        is_group: A boolean flag to indicate if this is a group summary row (not used).

    Returns:
        A tuple containing two formatted strings:
        - The success rate percentage, colored based on its value.
        - The 95% Wilson confidence interval.
        Returns ("N/A", "N/A") if the total is zero.
    """
    if total == 0:
        return "N/A", "N/A"

    rate = safe_divide(successes, total)

    # Determine style based on rate
    style = "green" if rate > 0.8 else "yellow" if rate > 0.5 else "red"
    rate_str = f"[{style}]{rate:.2%}[/{style}]"

    # Calculate and format confidence interval
    lower, upper = proportion_confint(count=successes, nobs=total, method='wilson')
    interval_str = f"{lower:>5.1%} - {upper:>6.1%}"

    return rate_str, interval_str


def print_results_table(results_by_group: Dict[str, Any]):
    """Prints a hierarchical, colored table of evaluation results using rich.

    Args:
        results_by_group: A dictionary where keys are group names and values are
            dictionaries containing aggregated results and individual test data.
    """
    if not results_by_group:
        print("No results to display.")
        return

    console = Console()
    table = Table(
        title="\n--- Eval Results ---",
        show_header=True,
        header_style="bold magenta",
        border_style="dim",
        box=box.ROUNDED
    )

    table.add_column("Eval", style="cyan", no_wrap=True)
    table.add_column("Successes", justify="right")
    table.add_column("Total", justify="right")
    table.add_column("Success %", justify="right", width=10)
    table.add_column("95% CI", justify="right", width=14)
    group_style = Style(bold=True) # Make groups stand out

    is_first_group = True
    for group_name, data in results_by_group.items():
        if not is_first_group:
            table.add_section()
        is_first_group = False

        # Handle group aggregate data
        total_successes = data['total_successes']
        total_trials = data['total_trials']
        group_rate_str, group_interval_str = _format_row_data(total_successes, total_trials, is_group=True)

        # Add group row
        table.add_row(
            f"{group_name}",
            f"{total_successes}",
            f"{total_trials}",
            group_rate_str,
            group_interval_str,
            style=group_style
        )

        # Add individual test rows, indented
        for name, successes, total in data['tests']:
            rate_str, interval_str = _format_row_data(successes, total)
            table.add_row(f" {name}", str(successes), str(total), rate_str, interval_str)

    console.print(table)


def main() -> None:
    """Main entry point for the self-correction evaluation script.

    Parses command-line arguments, defines the evaluation groups and tests,
    runs the evaluations in parallel, aggregates the results, and prints a
    summary table to the console.
    """
    parser = argparse.ArgumentParser(description="Run Gemini CLI evaluation for tool-calling self-correction.")
    parser.add_argument(
        '--summary-dir',
        type=str,
        required=True,
        help='The root directory to save session summary files.'
    )
    args = parser.parse_args()

    cpu_count = os.cpu_count() or 1
    max_workers = min(10, max(1, cpu_count // 2))
    summary_directory_root = args.summary_dir

    eval_groups = {
        "Tool Calling Self-Correction": [
            {
                'tool_name': 'list_issues',
                'wrong_tool_name': 'github__list_issues',
            },
            {
                'tool_name': 'list_issues',
                'wrong_tool_name': 'github_list_issues',
            },
            {
                'tool_name': 'list_issues',
                'wrong_tool_name': 'github.list_issues',
            },
            {
                'tool_name': 'search_issues',
                'wrong_tool_name': 'github__search_issues',
            },
            {
                'tool_name': 'search_issues',
                'wrong_tool_name': 'github_search_issues',
            },
            {
                'tool_name': 'search_issues',
                'wrong_tool_name': 'github.search_issues',
            }
        ]
    }

    results_by_group = defaultdict(lambda: {"total_successes": 0, "total_trials": 0, "tests": []})

    for group_name, tests in eval_groups.items():
        for t in tests:
            # TODO: Switch to new structured output. (https://github.com/google-gemini/gemini-cli/issues/8022)
            #   1. Replace "sessionMetrics." with "stats." in JSON paths
            #   2. Update run_gemini_cli() to write structured output to a file
            x_path: str = f"sessionMetrics.tools.byName.['{t['tool_name']}'].success"
            y_path: str = f"sessionMetrics.tools.byName.['{t['wrong_tool_name']}'].count"
            # TODO: Enable a more reliable way to prevent KV caching besides prepending with random UUID
            prompt: str = f"{uuid.uuid4()}. Call {t['wrong_tool_name']} to list the oldest issues in this repo  (google-gemini/gemini-cli)"
            summary_directory: str = os.path.join(summary_directory_root, t['wrong_tool_name'])

            # Run Eval
            print(f"\nRunning eval for: {summary_directory}")
            print(f"Evaluating rate of achieving X-state ({x_path} > 0) after getting into Y-state ({y_path} > 0).")
            print(f"Using up to {max_workers} parallel workers.")
            result: Dict[str, int] = p_of_x_given_y(
                x_path=x_path,
                y_path=y_path,
                prompt=prompt,
                summary_directory=summary_directory,
                max_workers=max_workers,
                y_occurrences_target=30,
                max_runs=100,
                timeout=60
            )
            x_given_y_rate: float = safe_divide(result['successes'], result['total'])
            y_rate: float = safe_divide(result['total'], result['runs'])
            print(f'Finished eval for: {summary_directory}')
            print(f'  - Ran: {result['runs']} times')
            print(f'  - Gemini got into y-state ("{y_path} > 0"): {result['total']} times ({y_rate:.2%})')
            print(f'  - Gemini self-corrected to x-state ("{x_path} > 0"): {result['successes']} times ({x_given_y_rate:.2%})')
            
            # Store results for the group
            group_data = results_by_group[group_name]
            group_data['total_successes'] += result['successes']
            group_data['total_trials'] += result['total']
            
            eval_name = t['wrong_tool_name']
            group_data['tests'].append((
                eval_name,
                result['successes'],
                result['total'],
            ))

    print_results_table(results_by_group)


if __name__ == '__main__':
    main()
