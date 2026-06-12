# StratOps Monetization and App Plan

Last updated: May 30, 2026

## StratOps Platform Preview

StratOps is a real-time, multi-domain intelligence visualization platform that leverages OSINT to synthesize aggregated telemetry streams and event signals into a live, 3D layered battlespace spanning air, land, sea, space, and cyberspace. It supports tracking of military movements, assessment of escalation dynamics, and continuous interpretation of operational changes within a theater of operations, in near real time. The platform is currently in development.

This early preview showcases part of the platform's evolving operational visualization capabilities, including:

- Multi-domain battlespace visualization spanning air, land, sea, space, and cyberspace.
- 3D military aircraft and naval vessel models for immersive asset tracking and close-range operational visualization.
- Continuous monitoring of military activity, operational events, escalation indicators, strategic developments, and emerging global flashpoints.
- Integrated intelligence layers combining OSINT, telemetry, military infrastructure, geospatial context, and operational activity.
- Region and Conflict Lens controls for focused analysis of active conflicts, strategic theaters, standoffs, and global activity.
- Premium operational overlays including radar coverage, threat rings, engagement ranges, and area-of-influence visualization.

StratOps aims to become a next-generation OSINT visualization environment for research, media awareness, analytical observation, and strategic monitoring of global security developments.

## Monetization Goal

Turn StratOps into a paid web platform first, then package it as an installable app after the paid web version proves demand.

The first revenue target is simple:

**Close 3 paying customers.**

If 3 people pay for StratOps, the platform has enough proof to keep building, improve onboarding, and move toward PWA/mobile app packaging.

## Product Positioning

Sell StratOps as:

**A live aircraft, naval, and conflict-monitoring dashboard for OSINT briefings, situational awareness, and geopolitical monitoring.**

Do not sell it as an official warning system, military authority, or classified intelligence product. The safe commercial positioning is OSINT visualization, research, media awareness, analysis, and monitoring.

## Target Customers

Start with people who already understand the value of OSINT and live visualization:

- OSINT creators
- independent geopolitical analysts
- aviation and defense watchers
- naval tracking communities
- geopolitical newsletter owners
- journalists and media researchers
- private security and risk consultants
- educators, students, and researchers in security studies

The first audience should be:

**OSINT creators and independent geopolitical analysts.**

They already need screenshots, recurring views, event summaries, and faster ways to explain what is happening.

## Pricing Strategy

Recommended public pricing:

- Free preview: $0/month
- Basic: $19/month
- Advanced: $49/month
- Expert: $149/month

Optional later offer:

- Client/team version: custom pricing after individual paid users exist

Do not build complex team billing yet. Team seats, admin roles, organization accounts, and invite flows should wait until there are paid customers asking for them.

## Why Users Buy Each Plan

### Free Preview

Free preview exists to let people understand the product before paying.

Free users can see enough to believe StratOps is real, but not enough to use it as their main workflow.

Free preview should include:

- basic map access
- limited event visibility
- limited widgets
- small aircraft/naval preview
- upgrade prompts on premium workflows

Reason it exists:

**Free preview builds trust and creates upgrade pressure.**

### Basic - $19/month

Basic is for casual viewers, small creators, students, and people who want a clean live map without the full operational workflow.

Basic users get:

- live map access
- limited aircraft tracker view
- limited naval tracker view
- core event feed
- basic widgets
- mobile browser access

Why users buy Basic:

- They want a low-cost way to access StratOps regularly.
- They are not ready for professional analysis tools yet.
- They want to follow events and see the platform without heavy workflows.

Best buyer:

**Casual OSINT viewers and small creators who want access, not full analysis power.**

### Advanced - $49/month

Advanced is the main plan to sell.

Advanced is where StratOps becomes a real monitoring and analysis tool instead of just a preview map.

Advanced users get:

- everything in Basic
- full aircraft tracker
- full naval tracker
- aircraft and naval focus mode
- region tools
- premium widgets
- premium operational overlays
- focused asset trails when track history exists
- nearby 3D aircraft/naval assets around focused assets

Why users buy Advanced:

- They need the full aircraft and naval tracker, not a limited preview.
- They want to focus assets and inspect activity closely.
- They need region tools to analyze theaters properly.
- They want radar/threat overlays and premium widgets for a deeper operational picture.

Best buyer:

**OSINT creators, aviation/naval watchers, journalists, and independent analysts who need useful live tracking and theater analysis.**

Core sales message:

**Basic lets you watch. Advanced lets you analyze.**

### Expert - $149/month

Expert is for power users who turn monitoring into repeatable work.

Expert users get:

- everything in Advanced
- saved views
- local alert rules
- briefing export workflow
- screenshot export workflow where browser canvas security allows it
- priority beta access

Why users buy Expert:

- They need to save recurring theater views.
- They monitor specific keywords, categories, or severity levels.
- They produce briefings, posts, videos, newsletters, research updates, or client reports.
- They want faster ways to capture and explain what they are seeing.

Best buyer:

**People using StratOps for work, research, content, briefings, client updates, or recurring professional analysis.**

Core sales message:

**Advanced is live analysis. Expert is professional workflow and reporting.**

## Current Implementation Status

### Free Preview

Status: implemented as the default unpaid tier.

Current behavior:

- unpaid users can enter the platform
- premium workflows can trigger upgrade prompts
- tracker access is limited
- billing tier is recognized by the app

### Basic

Status: implemented as a real paid tier.

Implemented:

- live map access
- limited aircraft tracker view
- limited naval tracker view
- core event feed
- basic widgets
- mobile browser access

Purpose:

Basic should feel useful but intentionally limited.

### Advanced

Status: implemented as the main paid analysis tier.

Implemented:

- full aircraft tracker
- full naval tracker
- aircraft focus mode
- naval focus mode
- region tools
- premium widgets
- premium operational overlays
- focused asset trails for aircraft when historical positions exist
- nearby 3D aircraft within the focused aircraft radius
- nearby 3D naval assets within the focused naval radius
- focus zoom-out warning and unfocus behavior

Purpose:

Advanced should be the plan most serious users choose.

### Expert

Status: implemented as a browser-local professional workflow tier.

Implemented:

- saved views stored locally in the browser
- local alert rules for visible events
- current match list for alert rules
- briefing copy to clipboard
- briefing Markdown download
- screenshot download attempt from the map canvas
- priority beta access as a business/support promise

Important limitation:

Saved views and alert rules are currently browser-local. That keeps the first release free to operate and avoids more paid services. Later, these can be synced to Supabase when paid users justify the cost.

## What Not To Build Yet

Do not build these until paid users request them:

- team seats
- organization admin portal
- invite emails
- shared saved views between users
- server-side alert notifications
- SMS alerts
- email alert delivery
- native App Store / Google Play submission
- white-label deployments

Reason:

These require more backend work, account management, support burden, or paid services. Build them after revenue starts.

## Billing Architecture

StratOps can keep BattlespaceX login as the account identity system while StratOps owns subscription status.

Recommended flow:

1. User signs in with BattlespaceX credentials.
2. StratOps validates the BattlespaceX session and reads a stable user id/email.
3. User chooses Basic, Advanced, or Expert inside StratOps.
4. StratOps creates a Stripe Checkout session from the server.
5. Stripe Checkout stores the StratOps user email/user id in metadata.
6. Stripe sends a webhook back to StratOps after payment.
7. StratOps stores the subscription record against that user/email.
8. When the user returns, StratOps checks the subscription store and unlocks the correct plan.

This keeps subscription display and feature access inside StratOps. The old BattlespaceX account area does not need subscription UI right now.

Current billing implementation:

- `/billing/create-checkout-session` exists for Stripe Checkout session creation.
- `/billing/webhook` exists for Stripe subscription updates.
- `/billing/me` exists so StratOps can check the logged-in user's plan.
- Supabase subscription storage exists for production.
- Local JSON subscription storage exists as a development fallback.
- Basic, Advanced, and Expert Stripe price IDs have been configured through environment variables.

Required environment variables:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_BASIC_PRICE_ID`
- `STRIPE_ADVANCED_PRICE_ID`
- `STRIPE_EXPERT_PRICE_ID`
- `STRATOPS_PUBLIC_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRATOPS_SUBSCRIPTIONS_TABLE`

Required Supabase table:

```sql
create table if not exists stratops_subscriptions (
  email text primary key,
  user_id text,
  plan text not null default 'free',
  status text not null default 'none',
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists stratops_subscriptions_user_id_idx
  on stratops_subscriptions (user_id);

create index if not exists stratops_subscriptions_stripe_subscription_id_idx
  on stratops_subscriptions (stripe_subscription_id);
```

## App Plan

Step 1: Make StratOps a paid web platform.

This is already the fastest path because users can pay through Stripe and access the app from the browser.

Step 2: Make StratOps installable as a PWA.

Needed assets:

- app icon
- splash screen
- mobile screenshots
- app name
- short description
- privacy policy page
- terms page
- manifest file

Step 3: Wrap the PWA as a native app later.

Use Capacitor or a similar wrapper only after paid web users exist. Do not spend time or money on app store submission before proving demand.

## Sales Funnel

Simple funnel:

1. Free preview gets attention.
2. Basic converts casual users.
3. Advanced converts serious monitoring users.
4. Expert converts people who create briefings, reports, content, or client updates.

Primary call to action:

**Start Advanced**

Reason:

Advanced is the strongest value balance and should become the default serious-user plan.

## Outreach Plan

Send direct messages to possible customers.

Example message:

> I am building StratOps, a live OSINT-style aircraft, naval, and conflict-monitoring dashboard for analysts and creators. I am opening a small paid beta. Would you want early access or a quick demo?

Send this to:

- 20 OSINT creators
- 20 aviation tracking accounts
- 20 naval tracking accounts
- 20 geopolitical newsletter owners
- 20 security/risk consultants

Target:

**100 messages.**

Goal:

**Book 5 demos and close 3 paid users.**

## Immediate Next Steps

1. Test Basic, Advanced, and Expert with real Stripe sandbox checkout.
2. Confirm StratOps always receives the BattlespaceX user email during login/session validation.
3. Verify Stripe webhook writes the correct plan to Supabase.
4. Test browser refresh after payment and after login.
5. Record 3 short demo clips:
   - Advanced focus mode and trackers
   - Expert saved views and briefing export
   - Premium overlays and region tools
6. Start outreach to the first 100 prospects.

## Release Decision

Launch the paid beta when these are true:

- login is stable
- Stripe checkout works in live mode
- webhook updates the correct user plan
- Basic/Advanced/Expert gates behave correctly
- Expert Tools open only for Expert users
- privacy and terms pages are live

After that, the job is not more features.

The job is getting the first 3 paid customers.
