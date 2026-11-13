# BizBook

![Next.js](https://img.shields.io/badge/Next.js-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?logo=supabase&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)

BizBook is a web application for coaching institutes to run daily operations and finances in one place. Institute owners, administrators, and accountants manage students, staff, attendance, fee installments, expenses, payroll, and reports, while a separate company-admin console handles subscription plans and support.

> [!NOTE]
> **Status: under development.** Payment provider flows have not been verified end-to-end against live or sandbox accounts.

## Highlights

- **Multi-tenant data model:** institute- and branch-level access, enforced through Supabase Auth, server-side role checks, and PostgreSQL Row Level Security
- **Fee ledger:** database functions allocate receipts across installments and process refunds atomically
- **Payments:** Razorpay and Cashfree integrations finalize a payment only after server-side signature verification or a provider status check
- **Supporting features:** request validation with Zod, PDF receipts with pdf-lib, and reports with Recharts

## Tech Stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js (App Router), React |
| Language | TypeScript |
| Backend services | Supabase (Auth, PostgreSQL, Storage) |
| Styling | Tailwind CSS |
| Validation | Zod |
| Reports and documents | Recharts, pdf-lib |
| Payments | Razorpay, Cashfree |
