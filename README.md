BizBook

BizBook is a web application for coaching institutes to run daily operations and finances in one place. Institute owners, administrators, and accountants manage students, staff, attendance, fee installments, expenses, payroll, and reports, while a separate company-admin console handles subscription plans and support.

Highlights

Multi-tenant data model with institute- and branch-level access, enforced through Supabase Auth, server-side role checks, and PostgreSQL Row Level Security
Fee ledger built on database functions that allocate receipts across installments and process refunds atomically
Razorpay and Cashfree integrations that finalize a payment only after server-side signature verification or a provider status check
Request validation with Zod, PDF receipts with pdf-lib, and reports with Recharts

Tech stack: Next.js (App Router), React, TypeScript, Supabase (Auth, PostgreSQL, Storage), Tailwind CSS

Status: Under development. Payment provider flows have not been verified end-to-end against live or sandbox accounts.
