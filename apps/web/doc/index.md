# SuperHero CPR — Documentation Index

This directory contains the full user documentation for the SuperHero CPR platform, organized by user type.

---

## Who This Documentation Is For

The platform has four types of users. Find your guide below.

| Role | Access Level | Guide |
|---|---|---|
| **Customer** | Public booking and account features | [Customer Guide](customer-guide.md) |
| **Instructor** | Own sessions, grading, invoicing | [Instructor Guide](instructor-guide.md) |
| **Manager** | All sessions, approvals, customers, payments, locations | [Manager Guide](manager-guide.md) |
| **Super Admin** | Full platform control including staff, certs, merch, settings | [Super Admin Guide](super-admin-guide.md) |

---

## Role Overview

### Customer
A customer is anyone who registers for a public account to book CPR classes online. Customers can browse the class schedule, complete checkout, view their upcoming classes, download their certifications, shop for merchandise, and manage their account. Sign in at `/signin` to access the customer dashboard.

### Instructor
An instructor is a staff member who teaches CPR classes. They have limited admin access focused on their own work: creating and managing their sessions, grading students after class, invoicing group clients, and submitting class data to Enrollware (the AHA certification system). Instructors access the admin area via `/signin` and land at `/admin`.

### Manager
A manager is a senior staff member responsible for approving instructor-submitted sessions, overseeing all classes and customers across the organization, managing payments, handling contact form replies, and maintaining the list of class locations. Managers have all instructor capabilities plus these additional responsibilities.

### Super Admin
A super admin has full control over the platform. This includes everything a manager can do plus: managing all staff accounts and bios, issuing and managing certifications, managing the merchandise store, viewing analytics, and configuring all system settings (class types, payment routing, Zoho Mail, Enrollware, and more). Super admins are typically the business owners or platform administrators.

---

## Quick Reference by Feature

| Feature | Who Can Use It | Covered In |
|---|---|---|
| Browse class schedule | Anyone (no account needed) | [Customer Guide §1](customer-guide.md#1-browsing-the-site) |
| Book a class | Customers | [Customer Guide §2](customer-guide.md#2-booking-a-class) |
| View upcoming bookings | Customers | [Customer Guide §3](customer-guide.md#3-your-dashboard) |
| Download certifications / eCards | Customers | [Customer Guide §5](customer-guide.md#5-your-certifications) |
| Shop for merchandise | Customers | [Customer Guide §8](customer-guide.md#8-shopping-for-merchandise) |
| Roll call check-in | Customers (class day) | [Customer Guide §7](customer-guide.md#7-roll-call-check-in) |
| Roster correction | Customers (group bookings) | [Customer Guide §9](customer-guide.md#9-roster-correction) |
| Create and manage sessions | Instructors + | [Instructor Guide §2](instructor-guide.md#2-managing-sessions) |
| Grade students | Instructors + | [Instructor Guide §4](instructor-guide.md#4-grading-students) |
| Create and send invoices | Instructors + | [Instructor Guide §5](instructor-guide.md#5-invoicing) |
| Connect PayPal payment account | Instructors + | [Instructor Guide §6](instructor-guide.md#6-connecting-your-payment-account) |
| Use Enrollware bookmarklet | Instructors + | [Instructor Guide §7](instructor-guide.md#7-enrollware-bookmarklet) |
| Approve / reject sessions | Managers + | [Manager Guide §3](manager-guide.md#3-approving-and-rejecting-sessions) |
| Import a class roster (CSV) | Managers + | [Manager Guide §5](manager-guide.md#5-importing-a-roster) |
| View all payments | Managers + | [Manager Guide §8](manager-guide.md#8-payments-ledger) |
| Manage customers (archive/restore) | Managers + | [Manager Guide §7](manager-guide.md#7-customer-management) |
| Manage locations | Managers + | [Manager Guide §9](manager-guide.md#9-locations) |
| Reply to contact submissions | Managers + | [Manager Guide §10](manager-guide.md#10-contact-submissions) |
| Manage staff accounts and bios | Super Admins only | [Super Admin Guide §3](super-admin-guide.md#3-staff-management) |
| Issue and manage certifications | Super Admins only | [Super Admin Guide §4](super-admin-guide.md#4-certifications) |
| Manage merchandise and products | Super Admins only | [Super Admin Guide §5](super-admin-guide.md#5-merchandise-and-products) |
| Manage orders | Super Admins only | [Super Admin Guide §6](super-admin-guide.md#6-orders) |
| View analytics | Super Admins only | [Super Admin Guide §7](super-admin-guide.md#7-analytics) |
| Configure system settings | Super Admins only | [Super Admin Guide §14](super-admin-guide.md#14-system-settings) |
| Permanently delete archived customers | Super Admins only | [Super Admin Guide §10](super-admin-guide.md#10-archived-customers) |
