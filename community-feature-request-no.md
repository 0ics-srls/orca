# Saying no to community feature requests

An `lgtm` on a feature request is read as “go write the PR.” That is what actually burns people.

GitHub’s maintainer guide is blunt: ignoring or leaving a request open hurts more than a short no, and **“No is temporary, yes is forever.”** Do not LGTM the idea and “figure out architecture later.” That is how you get a 400-line PR you then have to reject.

## The 3-beat comment

Same shape every time, in 1–2 sentences:

1. Thank the **problem** (not the design).
2. Say **no to this change**, with a project reason, not a personal one.
3. Give **one next step**, or close.

## Copy-paste comments

### Not something you want in the product

> Thanks for writing this up. We’re not going to take this on: it doesn’t match how we want this part of Orca to work. I’m going to close so it doesn’t sit in the queue as if it’s planned. You’re welcome to keep a fork if you need the behavior.

### Real problem, we will not take a community design for it

> Thanks, the pain here is real. We are not going to accept an implementation until a maintainer writes the approach (where it lives, what it must not add). Please don’t open a PR for this yet. I’ll leave a note on the issue when we have a shape, or we may just do it in-house.

### Real problem, wrong shape in the request

> Thanks for the report. We don’t want a new X for this; it belongs in existing Y. We’re not approving this as a feature to implement as written. If you want to help later, it would be a small change inside Y after we spec it, not a new module.

### Not now / not this release

> Thanks for sending this. We’re not going to take it in the near term, so I don’t want to imply it’s approved work. Closing for now so nobody spends time on a PR. If that changes we’ll reopen.

### We’ll take the idea, not the contribution

> Thanks, this is useful signal. We’re going to handle the design and implementation on our side so it fits the existing boundaries. I’ll credit you on the PR if we ship it. Please don’t send a patch in the meantime.

## What not to say

- “Great idea!” then no merge path. They hear go.
- “LGTM on the idea, let’s discuss architecture in the PR.” That is an implementation invitation.
- Long apologies. Kind + firm, not guilty. One sentence + close is enough.
- Leaving it open so you don’t feel mean. Open issues read as “someone will get to this.”
- A design debate in the thread. If they don’t own the boundary, more comments just train them to argue the architecture.

If they push back, one line is enough: **rejecting the change is not rejecting them.** Then stop. Hostile follow-up gets the CoC path, not a longer justification.

## One-liner

If you only use one sentence:

> I’m not going to approve this as work to implement, because I don’t want you to spend time on a PR we wouldn’t merge.
