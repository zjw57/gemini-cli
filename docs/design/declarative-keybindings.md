# **Declarative Keybindings**

This high-level design document outlines a significant change to the Gemini
CLI codebase. It is intended to facilitate collaboration between human
developers, domain experts, code reviewers, and AI coding assistants to ensure
a safe and correct implementation.

## **Process**

The process begins by seeding this document with high-level prompts. These
prompts will be shared with both coding assistants and human technical leads
to establish a mutual understanding of the project requirements.

The coding assistant will then update this document with a detailed overview
of the recommended approach, including risks, alternatives considered, and a
step-by-step plan for implementing and testing the changes.

We will share this document with human reviewers early in the process to
gather feedback from experts on this area of the Gemini CLI codebase.

After implementation, this document will be retained as a record of the design
process and serve as a reference for future projects.

After completion of this project, this document should no longer be materially
updated, though it can be appended with a record of related subsequent work if
that proves useful.

## **Initial Prompt**

We're going to work on a large project together to make it easier to add,
update, and discover keybindings for gemini-cli.

I anticipate that the best approach will be to rewrite the code that handles
specific keybindings. Instead of hardcoded logic, this code will create and
call a internal new API. This API will allow different parts of the
application to declare named callbacks, which will be recorded in a central
registry. A separate configuration file will then map specific keystrokes to
these named callbacks.

This approach will make keybindings discoverable, either by reading the
configuration file or by introspecting the registry at runtime. It will also
make it easier to detect conflicting key assignments.

This will be a major project. I want you to thoroughly analyze the problem,
understand the existing code and current implementations of keybindings within
the codebase, and help us decide whether this project is feasible.

In particular, I'd like to know if we can reimplement _all_ existing logic
without making breaking changes. I don't want to get partway down this path
only to discover during a rewrite that some critical existing piece of
functionality will no longer work.

We should use this as an opportunity to write very clean code and use the
process itself as an example for others.

## **Preliminary Discovery by Gemini**

### **1. Overview**

The current implementation of keybindings in the Gemini CLI relies on the
`useInput` hook from the `ink` library. This hook is used in various
components to handle keyboard input. The main application component,
`App.tsx`, handles global keybindings, while other components (like dialogs)
handle their own specific key events. This decentralized approach makes it
difficult to discover, manage, and update keybindings. It also increases the
risk of conflicting key assignments.

The proposed refactoring will introduce a centralized keybinding system. This
system will consist of:

- **A Keybinding Registry:** A central registry will store all available
  keybinding actions. Each action will have a unique name, a description, and
  a callback function.
- **A Configuration File:** A configuration file (e.g., `keybindings.json`)
  will map specific key combinations to the named actions in the registry.
  This will allow users to customize their keybindings.
- **A Keybinding Service:** A service will be responsible for reading the
  configuration file, listening for key presses, and invoking the appropriate
  callbacks from the registry.

### **2. Plan**

1. **Create the Keybinding Registry:**
   - Define a `Keybinding` interface with properties like `name`,
     `description`, `callback`, and `defaultKey`.
   - Implement a `KeybindingRegistry` class with methods to `register` and
     `get` keybindings.
   - The registry will be a singleton, accessible throughout the application.

1. **Implement the Keybinding Service:**
   - Create a `KeybindingService` that reads the keybinding configuration from
     a file.
   - The service will use a single `useInput` hook at the top level of the
     application (`App.tsx`).
   - When a key is pressed, the service will look up the corresponding action
     in the configuration and execute the callback from the registry.

1. **Refactor Existing Keybindings:**
   - Gradually refactor existing `useInput` hooks to use the new keybinding
     system.
   - For each keybinding, register it with the `KeybindingRegistry` and add an
     entry to the configuration file.
   - This can be done component by component to minimize disruption.

1. **Implement Keybinding Discovery:**
   - Add a `/help` command or a dedicated help view that displays all
     registered keybindings and their current assignments. This will use the
     information from the `KeybindingRegistry`.

### **3. Risks and Alternatives**

- **Risk:** Introducing a new system could be complex and might introduce new
  bugs.
  - **Mitigation:** We will implement the new system behind a feature flag
    initially. We will also write comprehensive tests for the new system.
- **Alternative:** Instead of a JSON configuration file, we could use a
  TypeScript file. This would provide better type safety but would be less
  user-friendly for customization. We believe a JSON file is a better choice
  for user-facing configuration.

### **4. Feasibility**

The proposed plan is feasible and will not result in any breaking changes for
users. We can reimplement all existing keybinding functionality using the new
system. The gradual refactoring approach will allow us to manage the
complexity and ensure a smooth transition.

## **Feedback from Human Reviewers**

## **Feedback from Human Reviewers**

Our human and AI reviewers provided detailed feedback on the initial design.
This section summarizes their key points, which will be used to shape the
final implementation plan.

### **Key Themes from Feedback**

#### **1. Context and Scope Management**

A primary concern raised by reviewers was the management of context-sensitive
keybindings. The initial design proposed a single, global `useInput` hook,
which does not account for scenarios where keybindings should only be active
within a specific UI context, such as a dialog, a text input field, or other
specialized components like `InputPrompt` and `TextBuffer`.

- **Challenge:** How does the system determine which keybinding to execute when
  multiple contexts are active or when a component-specific keybinding
  should override a global one?
- **Suggestion:** The design must incorporate a more sophisticated approach to
  context. This could involve a "lighter weight" solution where callers can
  resolve whether a specific input matches a keybinding, rather than a single
  service that takes full control of all keyboard input. This aligns better
  with the existing codebase, where `useInput` is used in multiple components.

#### **2. Separation of Concerns: Actions vs. Mappings**

Reviewers pointed out that the proposed `Keybinding` interface mixed the
_definition_ of an action (what it does) with its _mapping_ (how it's
triggered) by including a `defaultKey` property.

- **Challenge:** This approach creates ambiguity. It's unclear how a `defaultKey`
  would interact with a user's custom mapping in `keybindings.json`. Which
  one should take precedence in case of a conflict?
- **Suggestion:** The keybinding registry should only be concerned with being a
  collection of available **actions** (e.g., name, description, callback). The
  mapping of keys to these actions should be handled exclusively by a separate
  configuration layer. The `defaultKey` concept should be removed from the
  core interface and instead be used to generate a default `keybindings.json`
  file that users can then customize.

#### **3. Lifecycle Management**

The plan for gradual refactoring implies that components will register their
own keybindings. The initial design did not specify the lifecycle of these
registrations.

- **Challenge:** Without a clear lifecycle, the application could suffer from
  memory leaks (e.g., callbacks referencing unmounted components) or bugs where
  keybindings for inactive UI elements are still processed.
- **Suggestion:** The design must explicitly define when keybindings are
  registered and unregistered. This lifecycle should likely be tied to
  component lifecycle hooks (e.g., `useEffect` in React) and integrated with
  the context management system.

#### **4. Implementation and Discovery Details**

- **Complex Components:** The solution must be robust enough to handle the most
  complex existing keybinding implementations, such as those in `InputPrompt`
  and `TextBuffer`.
- **Discovery Command:** The proposal to use `/help` for keybinding discovery
  was questioned. A more specific or dedicated command might be more
  appropriate.
- **Feature Flag:** The suggestion to put the new system behind a feature flag
  was deemed unnecessary.

### **Summary of Reviewer Recommendations**

1.  **Refine the Core Service:** Move away from a single, monolithic
    `KeybindingService` that controls all input. Instead, design a more
    flexible system that allows different parts of the application to resolve
    keybindings based on the current context.
2.  **Clarify the `Keybinding` Definition:** Separate the action from the
    mapping. The registry should store actions, and the configuration file
    should store mappings.
3.  **Define Keybinding Lifecycle:** Specify how and when keybindings are
    registered and unregistered, tying it to the component lifecycle to prevent
    bugs and memory leaks.
4.  **Address Complex Cases:** Ensure the design explicitly accounts for the most
    complex keybinding scenarios in the current codebase.
5.  **Provide Concrete Examples:** The final design would benefit from code
    snippets or more concrete examples to illustrate how the proposed system
    will work in practice.

## **Final Design**

{{This section will be updated by Gemini with a final implementation plan
based on human feedback, a thorough understanding of the project goals and
requirements, and a complete read of the existing codebase.}}
