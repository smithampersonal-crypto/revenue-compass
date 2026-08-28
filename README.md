# Revenue Compass

Lovable First Prompt — ASC 606 SaaS Revenue Recognition App

I want to build a web application that demonstrates my technical accounting knowledge of ASC 606 as it applies to SaaS companies.

I am a CPA/accountant with no formal computer science or software engineering background. The primary purpose of this project is to create a polished portfolio application that I can demonstrate to accounting and finance professionals at SaaS and technology companies.

For now, do not build the application yet. First, help me create a detailed implementation plan for the MVP described below. Keep the architecture understandable and maintainable for a non-software-engineer. If there are technical decisions I need to make, recommend a sensible default and explain the decision in plain English.

1. Product concept

The application should function as a simplified ASC 606 revenue recognition engine for SaaS contracts.

The core workflow should be:

Enter contract information.

Apply the five-step ASC 606 revenue recognition framework.

Identify performance obligations.

Determine the transaction price.

Allocate the transaction price using relative standalone selling prices.

Determine the revenue recognition pattern for each performance obligation.

Generate a monthly revenue recognition schedule.

Generate a deferred revenue / contract asset waterfall based on the billing schedule.

Generate the related journal entries.

Show the accounting judgments and reasoning used in the analysis.

The application should look like professional SaaS accounting software, not a generic AI chatbot or consumer application.

2. Target user

The target user is a revenue accountant, senior accountant, accounting manager, controller, auditor, or technical accounting professional reviewing a SaaS customer contract.

The key action is:

Enter the facts of a SaaS contract and receive an organized ASC 606 analysis and revenue schedule that can be reviewed by an accountant.

3. MVP scope

The first version should intentionally be narrow.

The MVP SHOULD support:

Fixed-fee SaaS subscriptions

Multiple promised goods or services

SaaS subscriptions

Implementation services

Training

Support services

Manual determination of whether a promised good or service is distinct

Multiple performance obligations

Standalone selling prices

Relative SSP allocation

Discounts allocated using relative SSP

Over-time revenue recognition using a ratable time-elapsed method

Point-in-time revenue recognition

Mid-month contract start and end dates

Upfront billing

Monthly billing

Quarterly billing

Custom billing dates and amounts

Revenue schedules

Contract liability / deferred revenue schedules

Contract asset schedules when revenue precedes billing

Basic journal entries

Accounting judgment notes

Reconciliation and validation controls

The MVP should NOT yet include:

PDF contract uploads

AI contract extraction

Variable consideration

Usage-based pricing

Material rights

Renewal options requiring material-right analysis

Contract modifications

Significant financing components

Foreign currency

Refund rights

Cancellations or partial terminations

Complex SSP estimation techniques

Authentication or multiple users

ERP integrations

Design the architecture so those features could be added later, but do not build them into Version 1.

4. ASC 606 workflow

I want the application to visibly walk the accountant through all five ASC 606 steps.

Step 1 — Identify the contract

Provide inputs or checkboxes allowing the accountant to document whether:

The parties approved the contract and are committed to perform.

Each party's rights can be identified.

Payment terms can be identified.

The arrangement has commercial substance.

Collection of consideration is probable.

The application should show whether the arrangement qualifies for ASC 606 accounting based on the user's responses.

Include an optional field for the accountant's analysis or judgment notes.

Step 2 — Identify performance obligations

Allow the user to enter individual promised goods or services.

For each promise, capture:

Description

Standalone selling price

Whether the item is distinct

Accountant's reasoning

Whether it represents a separate performance obligation

Service start date, service end date, or point-in-time delivery date as applicable

The application should NOT use AI to make the distinctness determination in the MVP. The accountant should make and document the judgment.

Step 3 — Determine the transaction price

For Version 1, use fixed consideration only.

Capture:

Total fixed contract consideration

Billing schedule

Billing dates

Billing amounts

Validate that the total scheduled billings equal the contractual billing amount.

Step 4 — Allocate the transaction price

For separate performance obligations, calculate the allocation using the relative standalone selling price method.

For each performance obligation, display:

Standalone selling price

Total SSP

Relative SSP percentage

Allocated transaction price

The application should perform this calculation deterministically using application logic, not AI.

The total allocated transaction price must reconcile exactly to the total transaction price.

Step 5 — Recognize revenue

Allow two recognition patterns in Version 1:

Over time — ratable

Recognition start date

Recognition end date

Allocate revenue ratably over the service period

The calculation should support mid-month periods by calculating revenue based on calendar days and aggregating the result into monthly reporting periods

Point in time

Recognition date

Recognize the full allocated amount on the applicable date

All revenue calculations must be performed deterministically by the application.

5. Revenue schedule

Generate a monthly revenue schedule showing at minimum:

Month

Revenue by performance obligation

Total monthly revenue

Cumulative revenue

Include totals and validation controls.

The sum of scheduled revenue across all periods must equal the transaction price.

6. Deferred revenue / contract asset waterfall

Keep billing and revenue recognition as separate calculations.

For every monthly period, show:

Beginning contract balance

Billings

Revenue recognized

Ending contract balance

Clearly identify whether the ending balance represents:

Contract liability / deferred revenue, or

Contract asset / unbilled revenue

The waterfall must reconcile cumulative billings with cumulative revenue.

7. Journal entries

Generate illustrative journal entries based on the schedules.

Examples include:

Billing before revenue recognition:

Dr. Accounts Receivable
Cr. Deferred Revenue / Contract Liability

Revenue recognition where deferred revenue exists:

Dr. Deferred Revenue / Contract Liability
Cr. Revenue

Revenue recognition before billing where a contract asset exists:

Dr. Contract Asset
Cr. Revenue

Do not attempt to model cash receipts in Version 1 unless needed for the basic workflow.

Allow journal entries to be viewed by month.

8. Accounting judgments

Include a dedicated "Accounting Judgments" area.

For each significant judgment, show:

Accounting issue

Accountant's conclusion

Reasoning

Relevant ASC 606 citation entered or selected by the accountant

The application should emphasize that professional accounting judgment remains with the reviewer.

Do not present the application as replacing professional judgment or as providing authoritative accounting advice.

9. Validation controls

Accounting controls are an important part of the application.

Include validation checks such as:

Total SSP must be greater than zero.

Allocated transaction price must equal total transaction price.

Total revenue scheduled must equal total allocated revenue.

Total billings must reconcile to the entered billing amount.

Recognition dates must be valid.

Point-in-time recognition dates must be provided when applicable.

Over-time performance obligations must have valid start and end dates.

Ending contract balances must reconcile to cumulative billings less cumulative revenue.

Invalid or incomplete performance obligations should be clearly flagged.

I eventually want a visible validation status such as:

All Accounting Checks Passed

when all reconciliations succeed.

10. Initial screens

Please propose a clean application structure containing approximately these views:

Dashboard

Portfolio/demo introduction

Existing/sample contracts

"Create Contract" button

Several fictional SaaS contracts eventually available as examples

New Contract / ASC 606 Analysis

Use a clear five-step workflow corresponding to ASC 606 Steps 1–5.

The user should be able to move backward and forward without losing entered data.

Contract Results

Show:

Contract summary

ASC 606 conclusions

Performance obligations

SSP allocation

Revenue schedule

Deferred revenue / contract asset waterfall

Journal entries

Accounting judgments

Validation results

Use tabs or another clean navigation system if appropriate.

11. Visual design

Use a professional financial-software design.

I want the visual style to feel appropriate for a modern SaaS accounting or finance application.

Preferences:

Clean light interface

Professional rather than flashy

Strong table design because financial schedules are central to the product

Clear typography

Neutral colors

Subtle use of color for status, warnings, and validation results

Responsive design

Optimized primarily for desktop use but usable on tablets and mobile devices

Avoid excessive animations

Avoid gradients or overly decorative startup-style designs

Prioritize accounting information density and readability

12. Technology and architecture

Recommend the simplest appropriate architecture for someone without a software engineering background.

I am considering:

Lovable for application development

Supabase / PostgreSQL for the eventual backend and database

GitHub for source control

I expect to add an LLM API such as OpenAI or Anthropic later for contract extraction, but AI should NOT be part of the accounting calculation engine.

The architecture should maintain a clear separation between:

Contract facts and accounting judgments

and

Deterministic calculations

Future architecture should eventually look conceptually like:

Contract document
→ AI extraction
→ Structured contract data
→ Accountant review / overrides
→ Deterministic ASC 606 engine
→ Revenue schedules and accounting outputs

But Version 1 begins with manual contract input instead of contract documents or AI.

13. Database planning

Even if the first UI uses sample data, plan an eventual relational database structure that could reasonably contain entities such as:

contracts

contract_promises

performance_obligations

billing_events

revenue_schedule

accounting_judgments

journal_entries

Recommend an appropriate schema without making it unnecessarily complex.

I want the database to eventually provide an opportunity for me to demonstrate basic SQL knowledge.

14. Sample contract for development

Use a fictional SaaS company and customer for all sample data.

For example:

Contract term: January 1, 2027 through December 31, 2027

Contract consideration: $120,000

Performance obligations:

SaaS Platform Access

SSP: $120,000

Over-time recognition

January 1 through December 31

Customer Training

SSP: $20,000

Point-in-time recognition

Training delivered January 15

Assume both are distinct.

Use reasonable fictional contractual pricing so that the application can demonstrate relative SSP allocation.

All companies, customers, contracts, and data must be fictional.

15. Important development principles

Please follow these principles throughout the project:

Do not overengineer the MVP.

Build features in small, testable increments.

Explain technical decisions to me in plain English.

Keep accounting calculations deterministic and testable.

Do not use AI to perform arithmetic or create the underlying revenue schedule.

Separate billing from revenue recognition.

Preserve an audit trail of important accounting judgments.

Design calculations so they can later be unit tested.

Keep future AI functionality separate from the accounting engine.

Prioritize correctness and reconciliation over flashy features.

Use fictional data only.

Do not add features outside the defined MVP unless you first recommend them and explain why they are necessary.

What I want from you now

Do NOT write code yet.

First provide:

A concise summary of your understanding of the application.

The proposed MVP architecture in plain English.

The proposed pages and user flow.

The proposed data model and major entities.

How you would structure the deterministic ASC 606 calculation engine.

The order in which you recommend building the features.

Any accounting or technical assumptions that need to be resolved before implementation.

Features you recommend explicitly postponing until after the MVP.

Potential technical risks or areas where a non-developer is likely to encounter problems.

A proposed set of development phases that lets us build and test one feature at a time.

Do not start implementing until I review and approve the plan.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e4b6223e-9304-456b-ab12-5d513a3223a6).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
