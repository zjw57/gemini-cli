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

I anticipate that the best approach will be to rewrite the code that
handles specific keybindings. Instead of hardcoded logic, this code
will create and call a internal new API. This API will allow different
parts of the application to declare named callbacks, which will be
recorded in a central registry. A separate configuration file will
then map specific keystrokes to these named callbacks.

This approach will make keybindings discoverable, either by reading the
configuration file or by introspecting the registry at runtime. It will also
make it easier to detect conflicting key assignments.

This will be a major project. I want you to thoroughly analyze the problem,
understand the existing code and current implementations of keybindings within
the codebase, and help us decide whether this project is feasible.

In particular, I'd like to know if we can reimplement *all* existing logic
without making breaking changes. I don't want to get partway down this path
only to discover during a rewrite that some critical existing piece of
functionality will no longer work.

We should use this as an opportunity to write very clean code and use the
process itself as an example for others.

## **Preliminary Discovery by Gemini**

{{This section will be filled in by Gemini as an initial response and detailed
execution plan prior to writing any code. It will then be shared with human
reviewers for discussion and feedback before code is committed.}}

## **Feedback from Human Reviewers**

{{This section will be added after our area experts have had an opportunity to
review Gemini's design and plan.}}

## **Final Design**

{{This section will be updated by Gemini with a final implementation plan
based on human feedback, a thorough understanding of the project goals and
requirements, and a complete read of the existing codebase.}}
