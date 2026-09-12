# General ERP

## Master Product Requirements Specification

### Version 1.0 — 2026

---

## 1. Product Vision

### 1.1 Product objective

Build a modern, industry-standard **General ERP platform for Indian SMEs and mid-market businesses** that provides:

- Finance
- Accounting
- Sales
- CRM
- Procurement
- Inventory
- Warehouse
- HR
- Payroll
- Projects
- Assets
- Expenses
- Reporting
- Workflow automation
- Indian tax compliance
- AI-assisted business operations

The ERP will be developed as **one product/codebase** and deployed independently for multiple customers.

Each customer receives an isolated deployment and database.

### 1.2 Primary USP

> **Enterprise-grade ERP functionality without enterprise-grade complexity.**

The product must be:

- Easy to learn
- Easy to navigate
- Easy to configure
- Easy to deploy
- Easy to administer
- Easy to customize
- Easy to integrate
- Easy to migrate into
- Easy to operate daily

### 1.3 Product philosophy

The ERP should follow:

> **Simple by default. Powerful when needed.**

A new user should not need ERP expertise to perform common tasks.

Advanced functionality should progressively reveal itself rather than overwhelming the user.

---

# 2. Product Principles

## P0 — Non-negotiable

### Principle 1 — Ease of use

Every major workflow should minimize:

- clicks
- screens
- unnecessary fields
- duplicate data entry
- navigation
- training requirements

### Principle 2 — Configuration over customization

Customer-specific requirements should preferably be solved through:

- configuration
- workflows
- custom fields
- custom forms
- permissions
- rules
- reports
- templates
- integrations

and **not by modifying source code**.

### Principle 3 — One product, multiple customers

Do not maintain customer-specific forks.

```text
                    ERP PRODUCT
                         |
       +-----------------+-----------------+
       |                 |                 |
   Customer A         Customer B       Customer C
       |                 |                 |
   Configuration      Configuration    Configuration
       |                 |                 |
   Own Database       Own Database     Own Database

```

### Principle 4 — Financial integrity

Posted financial transactions must be controlled, auditable and reversible through proper accounting mechanisms.

### Principle 5 — API-first

Every major business capability should be accessible through APIs.

### Principle 6 — Auditability

Critical actions must be traceable.

### Principle 7 — AI-assisted, not AI-controlled

AI may recommend and execute permitted actions through controlled tools, but it must never bypass:

- permissions
- business rules
- approvals
- accounting controls
- audit requirements

---

# 3. ERP Functional Architecture

The product consists of the following domains:

```text
GENERAL ERP
|
+-- Platform
|   +-- Organization
|   +-- Users
|   +-- RBAC
|   +-- Configuration
|   +-- Workflow
|   +-- Audit
|   +-- Documents
|
+-- CRM & Sales
|   +-- Leads
|   +-- Opportunities
|   +-- Customers
|   +-- Quotations
|   +-- Sales Orders
|   +-- Delivery
|   +-- Invoicing
|   +-- Collections
|
+-- Procurement
|   +-- Suppliers
|   +-- Purchase Requests
|   +-- RFQ
|   +-- Supplier Quotations
|   +-- Purchase Orders
|   +-- GRN
|   +-- Purchase Invoices
|
+-- Inventory
|   +-- Products
|   +-- Warehouses
|   +-- Stock
|   +-- Batches
|   +-- Serials
|   +-- Transfers
|   +-- Stock Counts
|
+-- Finance
|   +-- General Ledger
|   +-- Accounts Receivable
|   +-- Accounts Payable
|   +-- Banking
|   +-- Tax
|   +-- Fixed Assets
|   +-- Expenses
|
+-- People
|   +-- HR
|   +-- Attendance
|   +-- Leave
|   +-- Payroll
|
+-- Projects
|   +-- Projects
|   +-- Tasks
|   +-- Timesheets
|   +-- Project Costing
|
+-- Analytics
|   +-- Reports
|   +-- Dashboards
|   +-- KPIs
|   +-- Budgets
|   +-- Forecasts
|
+-- AI
    +-- Copilot
    +-- Business Q&A
    +-- Insights
    +-- Agents
    +-- Automation

```

---

# 4. Module 1 — Organization Management

## 4.1 Submodules

- Company
- Legal Entity
- Branch
- Business Unit
- Department
- Location
- Warehouse
- Cost Center
- Profit Center
- Fiscal Year
- Accounting Period
- Currency
- Exchange Rates
- UOM
- Number Series
- Document Types

## 4.2 Entities

### Company

Fields:

- id
- legal\_name
- trade\_name
- registration\_number
- PAN
- TAN
- GSTIN
- CIN where applicable
- industry
- address
- city
- state
- country
- postal\_code
- phone
- email
- website
- logo
- default\_currency
- fiscal\_year\_start
- timezone
- status

### Branch

- id
- company\_id
- branch\_code
- name
- address
- GSTIN
- contact
- manager
- default\_warehouse
- cost\_center
- status

### Department

- id
- company\_id
- code
- name
- manager
- cost\_center
- parent\_department
- status

## 4.3 Business rules

- Company code must be unique.
- Branch code must be unique within company.
- Financial year cannot overlap another financial year.
- Closed accounting periods cannot accept normal postings.
- Default currency must exist before financial transactions.
- Every transaction must belong to an organizational context.

---

# 5. Module 2 — User, Roles & Security

## 5.1 Submodules

- Users
- Roles
- Permissions
- Teams
- Approval Authority
- Sessions
- MFA
- Login History
- Security Policies

## 5.2 Entities

### User

- id
- employee\_id
- username
- email
- mobile
- password\_hash
- status
- MFA status
- last\_login
- timezone
- language

### Role

- id
- name
- description
- permissions
- scope

### Permission

```text
module
resource
action
scope

```

Example:

```text
Sales
Invoice
Approve
Branch

```

## 5.3 Permission actions

Minimum:

- View
- Create
- Edit
- Delete
- Submit
- Approve
- Reject
- Cancel
- Reverse
- Export
- Print
- Import
- Configure

## 5.4 Data scope

- Own
- Team
- Department
- Branch
- Business Unit
- Company
- All

## 5.5 Enterprise controls

- MFA
- session timeout
- password policy
- IP restrictions
- login history
- device/session management
- failed login protection
- segregation of duties

---

# 6. Module 3 — CRM

## 6.1 Submodules

- Leads
- Contacts
- Companies
- Opportunities
- Activities
- Tasks
- Follow-ups
- Pipeline
- Campaign Sources

## 6.2 Lead lifecycle

```text
NEW
 ↓
QUALIFIED
 ↓
OPPORTUNITY
 ↓
QUOTATION
 ↓
WON

```

Alternative:

```text
NEW → DISQUALIFIED
NEW → LOST

```

## 6.3 Lead fields

- lead number
- name
- company
- phone
- email
- source
- industry
- location
- owner
- status
- probability
- expected value
- expected close date
- notes

---

# 7. Module 4 — Customer Management

## 7.1 Entity

Customer:

- customer\_code
- legal\_name
- display\_name
- customer\_type
- PAN
- GSTIN
- billing\_address
- shipping\_address
- contacts
- credit\_limit
- payment\_terms
- currency
- price\_list
- sales\_rep
- territory
- tax category
- status

## 7.2 Customer lifecycle

```text
PROSPECT
 ↓
ACTIVE
 ↓
ON HOLD
 ↓
INACTIVE

```

## 7.3 Customer controls

- credit limit
- overdue limit
- blocked sales
- payment terms
- pricing rules
- tax treatment

---

# 8. Module 5 — Sales

## 8.1 Sales lifecycle

```text
Lead
 ↓
Opportunity
 ↓
Quotation
 ↓
Sales Order
 ↓
Delivery
 ↓
Invoice
 ↓
Payment

```

## 8.2 Entities

### Quotation

- quotation\_number
- customer
- date
- validity
- items
- quantity
- rate
- discount
- tax
- total
- payment\_terms
- delivery\_terms
- salesperson
- status

### Sales Order

- order\_number
- customer
- quotation\_reference
- order\_date
- delivery\_date
- warehouse
- items
- pricing
- tax
- discount
- payment\_terms
- status

### Delivery

- delivery\_number
- customer
- sales\_order
- warehouse
- items
- quantities
- transporter
- vehicle
- delivery\_address
- status

### Sales Invoice

- invoice\_number
- customer
- invoice\_date
- due\_date
- items
- taxes
- discounts
- totals
- payment\_terms
- reference\_documents
- IRN
- E-way bill
- accounting\_status

---

# 9. Sales Document Lifecycle

```text
DRAFT
 ↓
SUBMITTED
 ↓
APPROVAL
 ↓
APPROVED
 ↓
CONFIRMED
 ↓
PARTIALLY FULFILLED
 ↓
COMPLETED

```

Cancellation:

```text
CONFIRMED
 ↓
CANCELLED

```

Financial correction:

```text
POSTED
 ↓
CREDIT NOTE / ADJUSTMENT

```

Do not allow destructive editing of posted financial documents.

---

# 10. Module 6 — Procurement

## 10.1 Lifecycle

```text
Purchase Requisition
 ↓
Approval
 ↓
RFQ
 ↓
Supplier Quotation
 ↓
Quotation Comparison
 ↓
Purchase Order
 ↓
Goods Receipt
 ↓
Purchase Invoice
 ↓
Payment

```

## 10.2 Entities

### Supplier

- supplier\_code
- legal\_name
- PAN
- GSTIN
- addresses
- contacts
- bank details
- payment terms
- credit terms
- rating
- status

### Purchase Requisition

- requester
- department
- required\_date
- items
- quantity
- estimated\_cost
- justification
- approval\_status

### RFQ

- RFQ number
- suppliers
- items
- quantity
- due date
- terms

### Purchase Order

- PO number
- supplier
- items
- quantities
- rates
- discounts
- tax
- delivery terms
- payment terms
- warehouse
- approval status

---

# 11. Three-Way Matching

The system must support:

```text
Purchase Order
      +
Goods Receipt
      +
Supplier Invoice
      ↓
Three-Way Match
      ↓
MATCH
   OR
EXCEPTION

```

Configurable tolerance:

```text
Quantity tolerance
Price tolerance
Tax tolerance
Amount tolerance

```

---

# 12. Module 7 — Product & Master Data

## 12.1 Product entity

- SKU
- name
- description
- product type
- category
- brand
- variant
- barcode
- HSN/SAC
- UOM
- purchase UOM
- sales UOM
- conversion
- tax category
- purchase price
- sales price
- costing method
- reorder level
- safety stock
- preferred supplier
- batch tracking
- serial tracking
- expiry tracking
- status

## 12.2 Product types

- Stock Item
- Service
- Non-stock Item
- Asset
- Consumable

## 12.3 Product lifecycle

```text
DRAFT
 ↓
ACTIVE
 ↓
INACTIVE
 ↓
ARCHIVED

```

---

# 13. Module 8 — Inventory

## 13.1 Inventory engine

Every stock change must generate a stock movement.

```text
Stock Receipt
Stock Issue
Transfer
Adjustment
Return
Opening Balance
Consumption
Reservation

```

## 13.2 Stock movement fields

- movement\_id
- product
- warehouse
- bin
- batch
- serial
- quantity
- UOM
- movement\_type
- reference\_type
- reference\_id
- unit\_cost
- total\_cost
- timestamp
- user

## 13.3 Inventory valuation

Support:

- FIFO
- Weighted Average
- Moving Average
- Standard Cost

The exact supported costing methods can be configurable by product/company where accounting policy permits.

---

# 14. Warehouse

## 14.1 Hierarchy

```text
Warehouse
 ↓
Zone
 ↓
Rack
 ↓
Shelf
 ↓
Bin

```

## 14.2 Operations

- Receiving
- Put-away
- Picking
- Packing
- Dispatch
- Transfer
- Cycle Count
- Stock Count

## 14.3 Barcode

Support:

- barcode generation
- barcode scanning
- product lookup
- batch lookup
- serial lookup
- warehouse scanning

---

# 15. Module 9 — Finance & Accounting

This is the financial backbone.

## 15.1 Submodules

- General Ledger
- Chart of Accounts
- Accounts Receivable
- Accounts Payable
- Cash
- Banking
- Tax
- Fixed Assets
- Expenses
- Financial Closing
- Financial Reports

---

# 16. Chart of Accounts

Support hierarchical accounts.

```text
Assets
├── Current Assets
│   ├── Cash
│   ├── Bank
│   ├── Inventory
│   └── Receivables
│
Liabilities
├── Current Liabilities
│   ├── Payables
│   └── Tax Payable
│
Income
├── Sales
└── Other Income
│
Expenses
├── Purchase
├── Salary
├── Rent
└── Utilities

```

## 16.1 Account fields

- account\_code
- name
- type
- parent
- currency
- cost\_center\_required
- project\_required
- active
- reconciliation\_required

---

# 17. Journal Engine

Every accounting transaction should produce balanced journal entries.

Requirement:

```text
Total Debit = Total Credit

```

Journal fields:

- journal\_id
- date
- source
- reference
- account
- debit
- credit
- currency
- exchange\_rate
- cost\_center
- project
- description
- created\_by
- posted\_at

---

# 18. Subledger Architecture

Operational modules must feed accounting.

```text
Sales
 ↓
AR Subledger
 ↓
General Ledger

Purchase
 ↓
AP Subledger
 ↓
General Ledger

Inventory
 ↓
Inventory Valuation
 ↓
General Ledger

Payroll
 ↓
Payroll Accounting
 ↓
General Ledger

```

Users should not need to manually create journal entries for normal operational transactions.

---

# 19. Accounts Receivable

Features:

- invoice
- receipt
- advance
- credit note
- debit note
- allocation
- aging
- customer statement
- collection
- dunning
- write-off
- bad debt provision

Reports:

- AR Aging
- Customer Outstanding
- Overdue
- Collection Forecast
- Customer Statement

---

# 20. Accounts Payable

Features:

- supplier invoice
- payment
- advance
- debit note
- credit note
- allocation
- aging
- supplier statement
- payment scheduling

Reports:

- AP Aging
- Supplier Outstanding
- Due Payments
- Supplier Statement

---

# 21. Bank Reconciliation

Workflow:

```text
Import Bank Statement
 ↓
Match Transactions
 ↓
Auto Match
 ↓
Manual Match
 ↓
Exceptions
 ↓
Reconciliation

```

Support:

- CSV
- Excel
- supported bank formats
- future banking APIs

---

# 22. Indian Tax Engine

Tax must be its own subsystem.

```text
Tax Engine
|
+-- GST
+-- CGST
+-- SGST
+-- IGST
+-- UTGST
+-- HSN
+-- SAC
+-- TDS
+-- Other tax rules

```

Tax rules must be:

- versioned
- effective-date based
- configurable
- centrally managed

Never hard-code tax percentages throughout the application.

---

# 23. GST

Support:

- GST registration
- GSTIN validation
- tax categories
- HSN/SAC
- CGST
- SGST
- IGST
- UTGST
- input tax
- output tax
- credit notes
- debit notes
- tax reports
- reconciliation

The GST integration layer must support changing GSTN API specifications rather than embedding a single API version into the core ERP. GSTN published 2026 API changes for e-invoice/e-way-bill flows and advised ERP vendors and system integrators to update their implementations.

---

# 24. E-Invoice

Workflow:

```text
Invoice
 ↓
Validate
 ↓
Submit to IRP
 ↓
IRN
 ↓
Signed Data
 ↓
QR Code
 ↓
Final Invoice

```

Support:

- generate IRN
- cancel IRN
- retrieve IRN
- QR code
- error handling
- retries
- status
- API logs

The integration must be versioned and replaceable.

---

# 25. E-Way Bill

Support:

- generation
- cancellation
- update
- extension where applicable
- vehicle information
- transporter information
- status
- API logs

---

# 26. Banking & Payments

Support:

- cash
- bank transfer
- UPI
- cards
- payment gateway
- cheque
- advance
- partial payment

UPI should be a first-class integration target for an India-focused ERP. NPCI reported more than 22.7 billion UPI transactions in June 2026, illustrating the scale of the ecosystem.

---

# 27. Module 10 — Expenses

## Workflow

```text
Employee
 ↓
Expense Claim
 ↓
Manager Approval
 ↓
Finance Approval
 ↓
Reimbursement
 ↓
Accounting

```

Fields:

- employee
- category
- date
- amount
- tax
- project
- cost center
- receipt
- description
- approval status

---

# 28. Module 11 — Fixed Assets

Lifecycle:

```text
Purchase
 ↓
Capitalization
 ↓
Active
 ↓
Depreciation
 ↓
Transfer
 ↓
Disposal

```

Features:

- asset register
- categories
- depreciation
- locations
- custodians
- transfers
- maintenance
- disposal
- impairment

---

# 29. Module 12 — HR

## Employee

Fields:

- employee ID
- name
- contact
- address
- department
- designation
- manager
- joining date
- employment type
- bank
- statutory information
- documents
- status

## HR lifecycle

```text
Applicant
 ↓
Employee
 ↓
Active
 ↓
Leave / Transfer
 ↓
Exit
 ↓
Archived

```

---

# 30. Attendance

Support:

- attendance
- shifts
- overtime
- late entry
- early exit
- holidays
- biometric integration
- attendance correction

---

# 31. Leave

Support:

- leave types
- leave policies
- accrual
- carry-forward
- approval
- holiday calendar
- leave balance

---

# 32. Payroll

Support:

- salary structure
- earnings
- deductions
- overtime
- reimbursements
- statutory deductions
- payroll processing
- payslips
- payroll accounting

India-specific statutory payroll rules must be implemented as configurable/versioned rules rather than hard-coded calculations.

---

# 33. Module 13 — Projects

## Workflow

```text
Project
 ↓
Planning
 ↓
Tasks
 ↓
Resources
 ↓
Timesheets
 ↓
Expenses
 ↓
Billing
 ↓
Profitability

```

Support:

- projects
- phases
- tasks
- milestones
- dependencies
- budgets
- resources
- timesheets
- project expenses
- billing
- profitability

---

# 34. Module 14 — Workflow Engine

This is one of the most important platform components.

## Workflow structure

```text
Trigger
 ↓
Conditions
 ↓
Rules
 ↓
Approval
 ↓
Action
 ↓
Notification

```

Example:

```text
WHEN Purchase Order is submitted

IF amount > ₹5,00,000

THEN
Finance Manager Approval

AND
Purchase Head Approval

AFTER approval

Release Purchase Order

```

## Supported actions

- approve
- reject
- assign
- notify
- email
- webhook
- create document
- update field
- trigger integration
- request approval

---

# 35. Configuration Engine

This is essential because the same ERP will serve multiple customers.

## Configurable areas

### Organization

- branches
- departments
- warehouses
- fiscal years

### Documents

- numbering
- prefixes
- fields
- layouts
- print formats

### Workflows

- approval levels
- thresholds
- conditions

### Business rules

- credit limits
- discounts
- pricing
- taxes
- inventory rules

### UI

- dashboard
- menus
- fields
- forms
- table columns

### Permissions

- roles
- scopes
- approval authority

---

# 36. Custom Fields

Users/admins should be able to add fields without code.

Example:

Customer:

```text
Standard:
Name
GSTIN
Phone
Email

Custom:
Industry Type
Dealer Grade
Territory
Customer Segment

```

Field types:

- text
- number
- currency
- date
- datetime
- boolean
- select
- multi-select
- relation
- file
- formula

---

# 37. Custom Forms

Customers should be able to configure:

- field order
- required fields
- hidden fields
- read-only fields
- sections
- tabs
- conditional visibility

Example:

```text
IF Customer Type = "Corporate"

SHOW:
Company Registration Number
Credit Limit
Payment Terms

IF Customer Type = "Individual"

HIDE:
Company Registration Number

```

---

# 38. Custom Reports

Users should eventually be able to build reports using:

```text
Data Source
 ↓
Filters
 ↓
Grouping
 ↓
Columns
 ↓
Calculations
 ↓
Chart

```

Without programming.

---

# 39. Print Template Engine

Documents should be configurable:

- invoice
- quotation
- purchase order
- delivery note
- receipt
- payment voucher
- payslip
- credit note

Customers can configure:

- logo
- colors
- fields
- footer
- terms
- signatures
- layout

---

# 40. Notification Engine

Channels:

- In-app
- Email
- SMS
- WhatsApp
- Push

Triggers:

```text
Invoice overdue
PO approved
Payment received
Low stock
Approval required
Leave approved
New lead

```

Users should control notification preferences.

---

# 41. Document Management

Support:

- attachments
- folders
- tags
- versions
- permissions
- expiry
- preview
- OCR
- search

Documents can attach to any entity.

---

# 42. Search

Global search is a major usability feature.

User can type:

```text
INV-1023

```

and immediately find:

- invoice
- customer
- payment
- related order

Or:

```text
Rajesh Kumar

```

and see:

- customer
- quotations
- orders
- invoices
- payments
- activities

Search should support:

- exact search
- fuzzy search
- filters
- recent searches
- global search
- module search

---

# 43. Dashboard

Every role gets a relevant dashboard.

### CEO

- Revenue
- Profit
- Cash
- Receivables
- Payables
- Sales
- Inventory
- Alerts

### Accountant

- Receivables
- Payables
- Bank balance
- Reconciliation
- Tax
- Pending approvals

### Sales Manager

- Pipeline
- Revenue
- Targets
- Salesperson performance
- Outstanding

### Purchase Manager

- Pending PRs
- RFQs
- POs
- Supplier performance

### Warehouse Manager

- Stock
- Low stock
- Pending receipts
- Pending dispatch
- Stock value

---

# 44. Reporting Engine

Reports should support:

- filters
- date range
- branch
- department
- customer
- supplier
- product
- salesperson
- warehouse
- cost center
- project

Exports:

- Excel
- CSV
- PDF

Scheduled reports:

```text
Every Monday 8 AM
 ↓
Sales Report
 ↓
Email Management

```

---

# 45. Analytics

## P1

- KPIs
- trends
- comparisons
- drill-down
- variance analysis

## P2

- forecasting
- anomaly detection
- profitability analysis
- working capital analytics

---

# 46. Budgeting & Forecasting

Support:

- annual budgets
- department budgets
- cost-center budgets
- project budgets
- revenue budgets
- expense budgets

Reports:

```text
Budget
vs
Actual
vs
Forecast

```

---

# 47. AI Layer

AI is a major differentiator but must respect ERP controls.

## AI Copilot

Natural language:

> "How much revenue did we generate last month?"

> "Which customers owe us more than ₹1 lakh?"

> "Show slow-moving inventory."

> "Why did gross margin fall?"

> "Compare Bangalore and Mumbai branches."

---

# 48. AI Actions

AI may:

- create quotation drafts
- create purchase requisition
- prepare payment batches
- summarize customer history
- prepare collection messages
- identify overdue invoices
- recommend reorder quantities
- summarize reports
- explain variances

But:

```text
AI
 ↓
ERP Tool
 ↓
Permission Check
 ↓
Business Rules
 ↓
Approval if required
 ↓
Transaction
 ↓
Audit Log

```

AI must never directly execute arbitrary SQL.

---

# 49. AI Agents

Potential agents:

### Finance Agent

- cash-flow analysis
- AR monitoring
- AP monitoring
- reconciliation assistance

### Sales Agent

- lead analysis
- follow-up recommendations
- customer insights

### Procurement Agent

- reorder recommendations
- supplier comparison
- price analysis

### Inventory Agent

- slow-moving inventory
- stock-out prediction
- reorder suggestions

### Management Agent

- daily business briefing
- KPI analysis
- anomaly detection

---

# 50. AI Governance

Every AI action must log:

- user
- AI agent
- prompt/context reference
- tool
- action
- data accessed
- result
- approval
- final outcome

Sensitive data access must obey normal user permissions.

---

# 51. API Platform

## REST

Every major resource gets an API.

Examples:

```text
GET /customers
POST /customers
GET /customers/{id}
PATCH /customers/{id}

GET /sales-orders
POST /sales-orders

GET /invoices
POST /invoices

GET /payments
POST /payments

```

## API features

- authentication
- authorization
- API keys
- OAuth
- rate limiting
- pagination
- filtering
- sorting
- idempotency
- versioning
- error standards

---

# 52. Webhooks

Examples:

```text
customer.created
customer.updated

quotation.created
quotation.approved

sales_order.created
sales_order.confirmed

invoice.created
invoice.posted
invoice.cancelled

payment.received

purchase_order.created
purchase_order.approved

stock.updated

```

---

# 53. Integration Framework

Create an abstraction:

```text
Integration Framework
|
+-- GST
+-- E-Invoice
+-- E-Way Bill
+-- Banking
+-- UPI
+-- Payment Gateway
+-- Email
+-- SMS
+-- WhatsApp
+-- Storage
+-- Identity Provider

```

Every integration should have:

- credentials
- configuration
- status
- health
- logs
- retries
- error handling
- sandbox/test mode where available
- versioning

---

# 54. Audit System

Audit must exist at platform level.

## Audit event

```text
user
timestamp
IP
device
module
entity
entity_id
action
old_value
new_value
reason

```

Track:

- create
- edit
- delete
- approve
- reject
- post
- cancel
- reverse
- export
- import
- login
- permission change
- configuration change

Financial audit logs should be tamper-resistant.

---

# 55. Data Privacy

The ERP will process personal data such as:

- employees
- customers
- contacts
- vendors
- users

The product should therefore provide architecture for:

- data access controls
- retention policies
- deletion/anonymization workflows where applicable
- data export
- privacy notices
- consent/processing records where applicable
- breach/security workflows

India's DPDP Rules 2025 were notified in November 2025 and include a phased implementation timeline, so the ERP should have a privacy/compliance layer rather than assuming a static regulatory environment.

---

# 56. Data Import

Critical for onboarding customers.

Support:

```text
Customers
Suppliers
Products
Opening Stock
Opening Balances
Employees
Chart of Accounts
Transactions

```

Import workflow:

```text
Upload
 ↓
Detect columns
 ↓
Map fields
 ↓
Validate
 ↓
Preview
 ↓
Fix errors
 ↓
Import
 ↓
Summary

```

Never directly import unvalidated data.

---

# 57. Data Export

Customers must be able to export their data.

Support:

- CSV
- Excel
- PDF
- JSON/API

Export permissions must be controlled and audited.

---

# 58. Backup & Restore

Each customer deployment must support:

- automated backup
- manual backup
- restore
- backup verification
- backup encryption
- retention
- disaster recovery

The ERP should expose:

```text
Backup Status
Last Backup
Backup Size
Restore Point
Backup Health

```

---

# 59. Deployment Architecture

The product is **not SaaS**.

Each customer gets an independent deployment.

```text
                YOUR ERP PRODUCT
                       |
        +--------------+--------------+
        |              |              |
     Client A       Client B       Client C
        |              |              |
      AWS            Azure          On-Prem
        |              |              |
    PostgreSQL     PostgreSQL     PostgreSQL

```

Each deployment should be:

- isolated
- independently backed up
- independently updated
- independently configured

---

# 60. No Customer Code Forks

Customer-specific requirements should be implemented through:

```text
Configuration
Custom Fields
Custom Forms
Workflow
Rules
Reports
Templates
Plugins
Integrations
Feature Flags

```

Not:

```text
if customer_id == "ABC":
    special_logic()

```

Customer-specific code should only exist through a formal extension/plugin mechanism.

---

# 61. Version Management

Every installation must report:

```text
ERP Version
Database Version
API Version
Integration Version
Configuration Version

```

Database changes must use migrations.

```text
001_initial
002_customers
003_inventory
004_accounting
005_tax
...

```

Never manually modify production databases.

---

# 62. Upgrade System

Support:

```text
Backup
 ↓
Pre-flight Check
 ↓
Database Migration
 ↓
Application Update
 ↓
Health Check
 ↓
Verification
 ↓
Complete

```

Rollback strategy must exist for failed deployments.

---

# 63. Ease-of-Use Requirements

This is our **primary USP** and should have explicit acceptance criteria.

## UX principle

A user should be able to complete common tasks without understanding the underlying ERP architecture.

### Example

Instead of forcing:

```text
Sales
 → Orders
 → Create
 → Select Customer
 → Select Warehouse
 → Add Item
 → Add Tax
 → Save
 → Submit
 → Approve

```

provide:

```text
+ New Sale

```

Then guide the user.

---

# 64. Progressive complexity

Default screen:

```text
Customer
Products
Quantity
Price
Payment
Save

```

Advanced:

```text
Tax
Warehouse
Cost Center
Project
Commission
Delivery Terms
Accounting

```

Advanced options should be expandable.

---

# 65. Global Quick Action

One button:

```text
+ New

```

Options:

```text
Customer
Supplier
Quotation
Sales Order
Invoice
Purchase Order
Payment
Receipt
Expense
Task
Employee

```

---

# 66. Command Center

Keyboard shortcut:

```text
Ctrl + K

```

User can search:

```text
Create invoice
Open customer
Find INV-1023
Show overdue invoices
New purchase order

```

This dramatically reduces navigation.

---

# 67. Contextual actions

On customer page:

```text
Customer
|
+-- Create Quotation
+-- Create Sales Order
+-- Create Invoice
+-- Record Payment
+-- Send Statement
+-- View Outstanding

```

Users shouldn't have to navigate away to another module.

---

# 68. Smart defaults

System should automatically remember:

- preferred warehouse
- payment terms
- tax category
- salesperson
- branch
- price list
- UOM

But always allow override where permitted.

---

# 69. Inline creation

While creating an invoice:

```text
Customer [ + Add Customer ]
Product  [ + Add Product ]

```

Don't force users to leave the invoice.

---

# 70. Draft autosave

Long forms should support:

- autosave
- draft recovery
- unsaved-change warning

---

# 71. Validation UX

Validation must be:

- immediate
- specific
- understandable
- actionable

Bad:

> Validation failed.

Good:

> GSTIN is invalid. Check the 15-character GSTIN and try again.

---

# 72. Empty states

Never show blank tables.

Instead:

```text
No customers yet.

Add your first customer to start creating quotations.

[ + Add Customer ]

```

---

# 73. Onboarding

Customer onboarding:

```text
Create Company
 ↓
Business Information
 ↓
GST
 ↓
Financial Year
 ↓
Chart of Accounts
 ↓
Branches
 ↓
Warehouses
 ↓
Users
 ↓
Import Data
 ↓
Complete

```

Provide:

> **Guided Setup**

and

> **Advanced Setup**

---

# 74. Help system

Every important screen should have:

- contextual help
- tooltips
- examples
- keyboard shortcuts
- documentation
- guided walkthrough

---

# 75. Accessibility

Target modern accessibility standards.

Support:

- keyboard navigation
- visible focus
- screen readers
- sufficient contrast
- semantic HTML
- accessible forms
- error announcements
- scalable text

---

# 76. Mobile strategy

The core ERP should initially be optimized for desktop/tablet.

However, responsive support should exist.

Dedicated mobile experiences should eventually target:

- approvals
- expenses
- sales
- CRM
- attendance
- field operations
- warehouse scanning

---

# 77. Notifications

Notification center:

```text
Notifications
|
+-- 3 approvals pending
+-- 5 overdue invoices
+-- 2 low-stock items
+-- Payment received
+-- Purchase order approved

```

Users can configure notification channels.

---

# 78. Business Rules Engine

Rules should be configurable.

Examples:

```text
IF customer overdue > ₹1,00,000
THEN block new order

```

```text
IF discount > 15%
THEN require sales manager approval

```

```text
IF PO > ₹5,00,000
THEN require finance approval

```

```text
IF stock < reorder level
THEN create purchase recommendation

```

---

# 79. Approval Engine

Support:

- single approval
- multiple approvals
- sequential approvals
- parallel approvals
- amount-based approval
- department-based approval
- branch-based approval
- escalation
- delegation

---

# 80. Exception Management

ERP should make exceptions visible.

Examples:

```text
Invoice mismatch
Stock mismatch
Payment mismatch
Tax mismatch
Approval overdue
PO vs GRN mismatch
Invoice vs PO mismatch

```

Provide:

```text
Exception Queue

```

rather than hiding errors.

---

# 81. Notifications & Escalation

Example:

```text
Approval pending
 ↓
24 hours
 ↓
Reminder
 ↓
48 hours
 ↓
Escalate
 ↓
Manager

```

---

# 82. Operational Dashboard

Management should see:

```text
Revenue
Gross Profit
Cash
Receivables
Payables
Inventory
Sales Pipeline
Expenses
Orders
Pending Approvals

```

Every KPI must support drill-down.

Example:

```text
Receivables ₹24.5L
        ↓
Customers
        ↓
Invoices
        ↓
Transactions

```

---

# 83. Financial Reporting

Required:

### P0

- Trial Balance
- General Ledger
- Profit & Loss
- Balance Sheet
- Cash Flow
- AR Aging
- AP Aging

### P1

- Branch profitability
- Cost center profitability
- Product profitability
- Customer profitability
- Budget vs actual

---

# 84. Operational Reporting

### Sales

- Sales by customer
- Sales by product
- Sales by branch
- Salesperson performance
- Quotation conversion

### Procurement

- Supplier spend
- Supplier performance
- Purchase price analysis

### Inventory

- Stock valuation
- Stock movement
- Inventory aging
- Slow-moving
- Fast-moving
- Stock turnover

---

# 85. API Security

Every API must support:

- authentication
- authorization
- tenant/deployment context
- rate limiting
- validation
- audit logging
- idempotency where relevant

---

# 86. API Versioning

Use:

```text
/api/v1
/api/v2

```

Never break existing integrations silently.

---

# 87. Integration Error Handling

Every external integration should have:

```text
Request
 ↓
Attempt
 ↓
Success

```

or:

```text
Attempt
 ↓
Failure
 ↓
Retry
 ↓
Failure
 ↓
Dead Letter / Exception
 ↓
Manual Resolution

```

---

# 88. Observability

Production deployment must expose:

- application logs
- API logs
- integration logs
- job logs
- database health
- CPU
- memory
- disk
- queue health
- backup health
- error tracking

---

# 89. System Health

Admin dashboard:

```text
System Health

Application       ✓
Database          ✓
Redis             ✓
Storage           ✓
Email             ✓
GST API           ✓
E-Invoice         ✓
E-Way Bill        ✓
Backups           ✓
Workers           ✓

```

---

# 90. Non-functional Requirements

## Performance

Target:

- normal UI interaction: <2 seconds
- standard API p95: <500 ms where practical
- long reports: asynchronous
- large exports: background jobs

## Reliability

- transaction consistency
- retryable jobs
- idempotency
- failure recovery
- health checks

## Security

- encryption
- MFA
- RBAC
- audit
- secure secrets
- rate limiting
- vulnerability scanning

## Scalability

Design for:

```text
10 users
100 users
500 users
1,000+ users

```

without rewriting the business domain.

---

# 91. Data Architecture

Separate:

### Master Data

```text
Customer
Supplier
Product
Employee
Account
Warehouse
Tax
Currency
UOM

```

### Transaction Data

```text
Quotation
Order
GRN
Invoice
Payment
Journal
Stock Movement
Expense
Payroll

```

### Configuration

```text
Workflow
Rules
Numbering
Pricing
Permissions
Forms
Fields
Reports

```

### Audit

```text
Audit Event
Security Event
Integration Event
System Event

```

---

# 92. Data Integrity Rules

Examples:

### Invoice

```text
Subtotal
+ Tax
- Discount
= Total

```

### Journal

```text
Total Debit = Total Credit

```

### Inventory

```text
Available Stock
=
Opening
+ Receipts
- Issues
+/- Adjustments

```

### AR

```text
Outstanding
=
Invoice
- Allocated Payments
- Credit Notes

```

These calculations must come from authoritative domain services, not duplicated across UI screens.

---

# 93. Idempotency

Critical operations must be idempotent.

Especially:

- payments
- invoice posting
- GST submission
- e-invoice
- e-way bill
- webhooks
- imports

A retry must not create duplicate financial transactions.

---

# 94. Concurrency

The ERP must handle two users editing the same record.

Support:

- optimistic locking
- version numbers
- conflict detection
- transaction locking where necessary

Example:

```text
User A opens Invoice
User B edits Invoice
User A attempts save
       ↓
Conflict detected
       ↓
User informed

```

---

# 95. Localization

The core ERP must support:

- timezone
- currency
- number formats
- date formats
- language
- tax localization

India is the initial localization.

The architecture should not prevent future countries.

---

# 96. Customer Customization Model

This is a critical product requirement.

### Level 1 — Configuration

No code.

```text
Company
Branches
Tax
Users
Roles
Workflows
Numbering

```

### Level 2 — Customization

No code.

```text
Custom Fields
Custom Forms
Custom Reports
Custom Dashboards
Templates
Rules

```

### Level 3 — Extension

Controlled development.

```text
Plugins
Integrations
Custom UI
Custom APIs

```

### Level 4 — Core changes

Only your product team.

Never create customer-specific source-code forks.

---

# 97. Feature Flags

Support:

```text
feature.sales
feature.inventory
feature.projects
feature.payroll
feature.ai
feature.advanced_warehouse

```

This allows different customers to use different product editions.

---

# 98. Edition Strategy

Potential editions:

### Essential

- Finance
- Sales
- Purchase
- Inventory

### Professional

- Essential
- CRM
- HR
- Payroll
- Projects
- Assets

### Enterprise

- Professional
- Advanced workflows
- advanced reporting
- APIs
- AI
- integrations
- advanced security

The underlying product remains the same.

---

# 99. AI Roadmap

## AI V1

- natural language search
- report explanation
- dashboard summaries
- document summarization

## AI V2

- business insights
- anomaly detection
- forecasting
- recommendations

## AI V3

- finance agent
- sales agent
- procurement agent
- inventory agent
- management agent

## AI V4

Controlled autonomous workflows.

---

# 100. Final Product Architecture

The conceptual architecture should be:

```text
                         GENERAL ERP
                              |
       +----------------------+----------------------+
       |                      |                      |
    PLATFORM              BUSINESS              INTELLIGENCE
       |                   DOMAINS                    |
       |                      |                       |
 Organization             Sales                    Reports
 Users/RBAC               CRM                      Analytics
 Security                 Purchase                 Dashboards
 Configuration            Inventory                Forecasting
 Workflow                 Finance                  AI
 Audit                    HR
 Documents                Projects
 Notifications            Assets
                           Expenses
                              |
                              ↓
                         DOMAIN SERVICES
                              |
                              ↓
                         ACCOUNTING ENGINE
                              |
                              ↓
                         DATA PLATFORM

```

---

# 101. The Most Important Product Requirement

The product should feel like:

> **One simple application**

even though internally it contains dozens of sophisticated modules.

The user should NOT feel:

> "I am using an ERP."

They should feel:

> **"I am running my business."**

That should influence every UX decision.

---

# 102. Product Success Criteria

The product should eventually be able to demonstrate:

### Ease of use

- New employee can perform basic tasks with minimal training.
- Common transactions require minimal navigation.
- Search can find anything relevant.
- Contextual actions reduce screen switching.
- Advanced functionality does not overwhelm beginners.

### Configurability

- New customer can configure the system without source-code changes.
- Custom fields can be created without development.
- Approval workflows can be changed without development.
- Document templates can be customized.
- Reports can be customized.
- Features/modules can be enabled/disabled.

### ERP correctness

- Financial transactions are auditable.
- Accounting remains balanced.
- Inventory and accounting remain synchronized.
- Documents have controlled lifecycles.
- Posted transactions cannot be silently altered.
- Critical operations are permission controlled.

### Deployment

- Customer can run the product independently.
- Customer data is isolated.
- Product can be backed up/restored.
- Product can be upgraded using controlled migrations.
- Customer-specific configuration survives upgrades.

### Modern capability

- API-first
- mobile-friendly
- AI-assisted
- analytics-driven
- integration-ready
- India-localized
- privacy-aware

---

# 103. Recommended Development Order

## Phase 0 — Product Foundation

Phase 0 must establish the reusable platform engines before building substantial business-domain functionality:

- Architecture and database conventions
- Authentication
- Authorization & Policy Engine
- Organization
- Master Data foundation
- Configuration Engine
- Rules Engine
- Workflow Engine
- Document Lifecycle Engine
- Numbering & Sequence Engine
- Audit Engine
- Accounting Engine
- Tax Engine foundation
- Pricing Engine foundation
- File/Storage Engine
- Notification Engine
- Integration Engine
- Job & Queue Engine
- Search foundation
- Import/Export foundation
- API framework
- Observability
- Security
- Feature flags
- AI Tool & Action Gateway foundation

## Phase 1 — Core ERP

```text
Customers
Suppliers
Products
Sales
Purchase
Inventory
Warehouses
Payments

```

## Phase 2 — Accounting

```text
Chart of Accounts
GL
AR
AP
Banking
Reconciliation
Assets
Expenses
Financial reports

```

## Phase 3 — India

```text
GST
Tax engine
E-Invoice
E-Way Bill
TDS
Indian payroll
UPI/payment integrations

```

## Phase 4 — Enterprise

```text
Projects
HR
Payroll
Budgeting
Advanced approvals
Advanced reporting
Document management
Supplier management

```

## Phase 5 — Customization Platform

```text
Custom Fields
Custom Forms
Custom Reports
Custom Dashboards
Workflow Builder
Rule Builder
Print Template Builder
Configuration Studio

```

## Phase 6 — AI

```text
AI Copilot
Business Q&A
Insights
Forecasting
Anomaly detection
AI agents
Controlled AI actions

```

---


# 103A. Architectural Decisions — Locked

The following decisions are considered foundational product architecture and should not be casually changed during implementation:

1. The ERP is a modular monolith initially; business domains and platform engines are separated by clear service boundaries.
2. Configuration, Workflow, Rules, Authorization/Policy, Audit, Accounting, Document Lifecycle, Master Data, Tax, Integration, Job/Queue and Notification are platform capabilities.
3. Business domains must consume these capabilities rather than implement duplicate logic.
4. Accounting is authoritative for ledger posting; posted financial records are immutable except through controlled reversal/correction flows.
5. Business rules and workflows are configuration-driven and versioned.
6. Customer-specific behavior must use configuration, customization or controlled extensions—not source-code forks.
7. AI can propose or execute actions only through the same authorization, rules, workflow, domain-service and audit boundaries used by human/API operations.
8. All critical external operations must be idempotent and retry-safe.
9. Every state-changing operation must have an identifiable audit trail.
10. Domain services are the authoritative source for business calculations; UI code must not become the source of business truth.
11. Platform engines must remain domain-agnostic wherever practical.
12. All schemas, APIs and migrations must be version-controlled and backward-compatibility must be considered before breaking changes.
13. The system must support independent customer deployments with isolated data, configuration, backups and controlled upgrades.
14. The architecture must allow future extraction of individual services if scale or operational requirements justify it, without requiring premature microservices adoption.

These decisions are intended to protect the ERP from domain coupling, customer-specific forks, duplicated business logic, unsafe AI actions and accounting inconsistencies.


# 104. Definition of Done for the ERP

The ERP should not be considered commercially mature merely because every module has CRUD screens.

A module is complete only when it has:

- Master data
- Transaction entities
- Business rules
- Lifecycle/statuses
- Validation
- Permissions
- Approval workflow where required
- Accounting impact where applicable
- Audit trail
- Reports
- Search
- Import/export
- APIs
- Notifications
- Configuration
- Error handling
- Accessibility
- UX validation
- Test coverage
- Documentation

---

# 105. Final Product Positioning

The product should ultimately represent:

> **A configurable, enterprise-grade General ERP designed for Indian businesses, with the usability of a modern SaaS application and the control, accounting integrity and configurability expected from enterprise ERP.**

The differentiators should be:

### 1. Easy to use

### 2. Highly configurable

### 3. India-first

### 4. Enterprise-grade controls

### 5. Independently deployable

### 6. API-first

### 7. AI-native

### 8. No customer-specific code forks

The goal is **not to build a smaller SAP**.

The goal is to build a system that gives a 50-person company the operational discipline of an enterprise ERP without forcing its employees to navigate an unnecessarily complicated enterprise interface.


# 3. Product Architecture — Foundational Platform Engines

The ERP must be architected as a **platform foundation + business domains + analytics + AI**.

The following are **foundational platform capabilities, not ordinary business modules**. They must be implemented once and reused by all business domains.

## 3.1 Foundational engines

### P0 — Mandatory platform engines

1. **Configuration Engine**
   - Organization settings
   - Branches, departments, warehouses and fiscal years
   - Document numbering and layouts
   - Custom fields and forms
   - Workflow configuration
   - Business rules
   - UI configuration
   - Permissions and approval authority
   - Feature configuration
   - Customer-specific configuration without source-code changes

2. **Workflow Engine**
   - Trigger → conditions → rules → approval → action → notification
   - Single, multiple, sequential and parallel approvals
   - Amount-, department-, branch- and role-based approvals
   - Escalation and delegation
   - Approval history
   - Workflow versioning
   - Workflow simulation/test mode

3. **Rules Engine**
   - Declarative business rules
   - Conditions and expressions
   - Effective dates and rule versions
   - Validation rules
   - Blocking rules
   - Derived-field rules
   - Approval-triggering rules
   - Recommendation-triggering rules
   - Rule execution history

4. **Authorization & Policy Engine**
   - RBAC
   - Action permissions
   - Record/data scope
   - Field-level permissions where required
   - Approval authority
   - Segregation of duties
   - Policy evaluation
   - API authorization
   - AI action authorization

5. **Audit Engine**
   - Immutable audit events
   - User, timestamp, IP, device/session and source
   - Entity and entity ID
   - Action
   - Old/new values where appropriate
   - Reason/comments
   - Workflow events
   - Accounting events
   - Integration events
   - AI actions
   - Security events
   - Configuration changes
   - Export/import events

6. **Accounting Engine**
   - Accounting event model
   - Account determination
   - Journal generation
   - Debit/credit validation
   - Posting
   - Reversal
   - Financial period controls
   - Dimensions
   - Currency and exchange rates
   - Subledger integration
   - Accounting audit trail

7. **Document Lifecycle Engine**
   - Draft
   - Submit
   - Approval
   - Approve/reject
   - Confirm
   - Post
   - Fulfil
   - Complete
   - Cancel
   - Reverse
   - Amend
   - Credit/debit correction
   - State transition validation
   - Document version/history

8. **Master Data Engine**
   - Customer
   - Supplier
   - Product
   - Employee
   - Account
   - Warehouse
   - Tax
   - Currency
   - UOM
   - Cost center
   - Profit center
   - Project
   - Shared master-data ownership and validation

9. **Tax Engine**
   - Tax determination
   - Tax categories
   - GST
   - CGST/SGST/IGST/UTGST
   - HSN/SAC
   - TDS
   - Input/output tax
   - Tax exemptions
   - Effective-dated tax rules
   - Tax calculation and accounting integration
   - Country/localization abstraction

10. **Integration Engine**
    - Connector abstraction
    - Credentials/configuration
    - Health checks
    - Request/response logging
    - Retry and timeout policy
    - Idempotency
    - Error handling
    - Dead-letter/exception handling
    - Versioning
    - Sandbox/test mode where available
    - GST/e-invoice/e-way bill, banking, UPI, payments, messaging and identity connectors

11. **Job & Queue Engine**
    - Background jobs
    - Scheduled jobs
    - Queue management
    - Retries
    - Dead-letter handling
    - Job status/progress
    - Idempotent execution
    - Worker health
    - Long-running reports/exports
    - Integration synchronization
    - Scheduled automation

12. **Notification Engine**
    - In-app notifications
    - Email
    - SMS
    - WhatsApp
    - Push
    - Templates
    - User preferences
    - Immediate notifications
    - Reminders
    - Escalations
    - Digests
    - Delivery status and failure handling

13. **Numbering & Sequence Engine**
    - Document-specific sequences
    - Prefix/suffix
    - Fiscal-year reset
    - Branch/location sequences
    - Configurable formats
    - Concurrency-safe allocation
    - Numbering policies
    - Manual numbering where permitted

### P1 — Shared platform capabilities

14. **Pricing Engine**
    - Price lists
    - Customer/supplier pricing
    - Quantity breaks
    - Effective dates
    - Discounts
    - Promotions
    - Contract pricing
    - Currency/UOM-aware pricing
    - Approval thresholds

15. **Search Engine**
    - Global search
    - Exact/fuzzy search
    - Filters
    - Recent searches
    - Cross-module results
    - Permission-aware search
    - Command/action search

16. **File & Document Storage Engine**
    - Attachments
    - Metadata
    - Versioning
    - Access control
    - Expiry
    - Preview
    - OCR
    - Search
    - Storage abstraction

17. **Import/Export Engine**
    - CSV/Excel import
    - Mapping
    - Validation
    - Preview
    - Error correction
    - Batch processing
    - Import history
    - CSV/Excel/PDF/JSON export
    - Permission and audit controls

18. **Reporting & Query Engine**
    - Shared report query model
    - Filters
    - Grouping
    - Aggregations
    - Drill-down
    - Export
    - Scheduled reports
    - Permission-aware data access

19. **Localization Engine**
    - Timezone
    - Currency
    - Number formats
    - Date formats
    - Language
    - Tax localization
    - Locale-aware formatting

20. **Feature Flag & Edition Engine**
    - Feature enable/disable
    - Edition controls
    - Controlled rollout
    - Module availability
    - Configuration-aware feature gates

21. **AI Tool & Action Gateway**
    - AI tool registry
    - Permission checks
    - Context resolution
    - Business-rule validation
    - Approval enforcement
    - Idempotency
    - Action execution
    - AI audit trail
    - No direct LLM-to-database writes

## 3.2 Architectural dependency rules

Business domains consume platform engines:

```text
CRM / Sales / Procurement / Inventory / Finance / HR / Payroll / Projects
                              |
                              v
                    PLATFORM ENGINES
```

Platform engines must not depend on business-domain implementations.

```text
Sales → Accounting Engine       ✓
Sales → Workflow Engine         ✓
Sales → Rules Engine            ✓
Sales → Audit Engine            ✓

Accounting Engine → Sales       ✗
Workflow Engine → Sales         ✗
Audit Engine → Sales            ✗
```

Each engine must expose stable internal service interfaces and, where appropriate, API contracts.

## 3.3 Authoritative ownership rule

Each important business concept must have one authoritative owner.

Examples:

```text
Customer → Master Data / Customer Domain
Product  → Master Data / Product Domain
Invoice  → Sales Domain
Stock    → Inventory Domain
Journal  → Accounting Engine
Tax      → Tax Engine
Workflow → Workflow Engine
Audit    → Audit Engine
```

Other domains consume authoritative services rather than maintaining competing copies of business truth.

## 3.4 Cross-domain transaction rule

A business transaction should follow this pattern:

```text
User / API / Automation / AI
            |
            v
     Domain Service
            |
            +--> Rules Engine
            |
            +--> Policy Engine
            |
            +--> Workflow Engine (if required)
            |
            +--> Tax/Pricing Engine (if required)
            |
            +--> Accounting Engine (if required)
            |
            +--> Integration Engine (if required)
            |
            +--> Notification Engine
            |
            +--> Audit Engine
```

The domain service remains the authoritative coordinator for the business transaction.

## 3.5 Financial integrity rule

Financially relevant domain operations must never directly manipulate ledger tables from UI code or ad-hoc SQL.

```text
Business Event
      ↓
Domain Service
      ↓
Accounting Event
      ↓
Accounting Engine
      ↓
Validated Journal
      ↓
Posting
      ↓
Audit
```

Hard invariant:

```text
Total Debit = Total Credit
```

## 3.6 AI safety boundary

AI must use the same platform controls as human users.

```text
AI
 ↓
Tool Gateway
 ↓
Authorization / Policy
 ↓
Business Rules
 ↓
Workflow / Approval
 ↓
Domain Service
 ↓
Accounting / Tax / Inventory / Integration
 ↓
Audit
```

Never permit:

```text
LLM → SQL → Production Data
```

## 3.7 Platform-engine definition of done

A foundational engine is not complete when its CRUD tables exist.

It must have:

- stable service/API contract
- authorization
- validation
- configuration
- auditability
- error handling
- idempotency where applicable
- concurrency handling where applicable
- observability
- tests
- documentation
- migration strategy
- versioning strategy where applicable
- integration hooks where applicable
- failure/recovery behavior

