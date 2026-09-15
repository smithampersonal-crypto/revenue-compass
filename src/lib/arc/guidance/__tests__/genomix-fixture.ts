/* eslint-disable no-irregular-whitespace -- verbatim extracted PDF text */
/**
 * Full four-page Genomix / Synthesis BioAnalytics acceptance fixture.
 *
 * Fictional contract text, extracted verbatim from the four physical pages of
 * the acceptance PDF. It exists so retrieval precision is regression-tested
 * against a COMPLETE contract corpus, not a short synthetic excerpt: the
 * incidental "equity interest", "lease" and "tier" wording that produced
 * contextual false positives only appears in the full document.
 */

export const GENOMIX_FULL_CONTRACT_TEXT = String.raw`
L I F E S C I E N C E S SA A S L E G A L PAC K AG E

MASTER SUBSCRIPTION AGREEMENT
Effective Date: November 1, 2026 | Document Ref: MSA-2026-SYN-4102




                                Synthesis BioAnalytics Inc.                                     Genomix Clinical Diagnostics LLC
        PROVIDER                Delaware Corporation | Cambridge, MA       CUSTOMER             Delaware LLC | South San Francisco, CA
                                02139                                                           94080

                                                                                                legal@synthesisbio.com /
        GOVERNING LAW           State of Delaware (USA)                    PRIMARY NOTICE
                                                                                                contracts@genomixdx.com

      This Master Subscription Agreement (“Agreement”) is entered into as of November 1, 2026 (“Effective Date”) by and between
      Synthesis BioAnalytics Inc. (“Provider”) and Genomix Clinical Diagnostics LLC (“Customer”). Provider and Customer may each be
      referred to herein individually as a “Party” or collectively as the “Parties.” In consideration of mutual covenants, premises, and fees
      set forth herein, the Parties agree as follows:

      1. DEFINITIONS
      1.1 “Affiliate” means any entity directly or indirectly controlling, controlled by, or under common control with a Party (>50% voting
      stock or equity interest).
      1.2 “Clinical Specimen Metadata” means sample accession identifiers, sequencing assay metrics, FASTQ/VCF pipeline execution
      logs, and bioinformatics annotation data generated or analyzed by Customer via the Platform.
      1.3 “Documentation” means Provider’s validated bioinformatics pipeline manuals, GxP validation packages, and API schema
      specifications.
      1.4 “Order Form” means an ordering document executed by both Parties referencing this Agreement detailing tier licensing, NGS
      sample throughput quotas, and compliance addenda.
      1.5 “SaaS Platform” means Provider’s cloud-native genomic variant calling, tertiary annotation, and CLIA/CAP-ready audit suite
      (“HelixFlow Cloud”).
      1.6 “User” means a molecular pathologist, certified laboratory director, or authorized bioinformatician credentialed under
      Customer’s enterprise account.

      2. ACCESS RIGHTS AND GXP REGULATORY SCOPE
      2.1 Provision of Access: Subject to compliance with this Agreement and payment of Fees in applicable Order Forms, Provider grants
      Customer a worldwide, non-exclusive, non-transferable right during the Subscription Term to access and use the SaaS Platform
      strictly for Customer’s CLIA-certified genomic diagnostic workflows.
      2.2 Authorized Users & Identity Governance: Access requires MFA-enforced SAML 2.0 federation (Okta / Azure AD). Customer
      maintains exclusive responsibility for role-based access control (RBAC) sign-off granting clinical sign-out privileges to licensed
      directors.
      2.3 Usage Restrictions: Customer shall not: (a) reverse-engineer or extract proprietary neural variant callers or hidden Markov
      alignment weights; (b) lease or white-label clinical reporting outputs to third-party reference laboratories without explicit
      addendum; (c) inject corrupted VCF references or breach HIPAA Business Associate Agreement (BAA) boundaries; or (d) violate FDA
      SaMD or HIPAA security rules.
      2.4 Service Availability & Maintenance: Provider shall maintain monthly infrastructure availability of not less than 99.95%
      excluding validated scheduled maintenance windows announced ≥96 hours in prior coordination.

      3. COMMERCIAL TERMS, FEES, AND TAXES
      3.1 Fees and Invoicing: Customer shall pay all Fees specified in Attachment A (Order Form). Platform subscription fees and
      sequencing batch throughput overages are invoiced net thirty (30) days from invoice date via electronic wire transfer.
      3.2 Late Payment Mechanics: Overdue balances accrue late finance charges at 1.5% per month (or maximum statutory rate
      enforceable in Delaware, whichever is lower). If an invoice remains unpaid twenty (20) days after written delinquency notice,
      Provider reserves the right to suspend non-diagnostic exploratory pipeline runs until cure.
      3.3 Taxes: Fees exclude federal, state, and local sales, use, value-added, or withholding taxes. Customer shall remit any legally
      required withholding taxes directly or supply a valid direct-pay tax exemption certificate valid in California and Delaware prior to
      billing execution.




      CONFIDENTIAL — SYNTHESIS BIOANALYTICS INC. / GENOMIX CLINICAL LABS LLC                                                       Page 1 of 4
4. INTELLECTUAL PROPERTY & DATA SOVEREIGNTY
4.1 Provider IP Ownership: Provider retains all right, title, and interest in and to the SaaS Platform, basecaller integration wrappers,
variant annotation reference databases, and underlying software algorithms. Nothing herein transfers source code or model weights
to Customer.
4.2 Clinical Specimen Sovereignty: Customer retains exclusive title to all Clinical Specimen Metadata and patient genomic reads.
Provider acquires a limited, encrypted processing license solely to render bioinformatics analysis under HIPAA BAA strictures.
4.3 De-identified Population Aggregation: Provider may utilize strictly HIPAA-de-identified (Safe Harbor compliant) variant
frequency distributions to benchmark clinical diagnostic sensitivity across multi-center cohorts, provided zero patient PHI, accession
barcodes, or institutional identifiers are retained.

5. CONFIDENTIALITY & HIPAA COMPLIANCE OBLIGATIONS
5.1 Protection Standard: Each Party (“Receiving Party”) shall protect non-public Confidential Information disclosed by the other
Party (“Disclosing Party”) using enterprise cryptographic controls meeting NIST SP 800-88 / HIPAA Security Rule standards.
5.2 BAA Incorporation: Processing of Protected Health Information (PHI) is governed strictly by the executed HIPAA Business
Associate Agreement attached hereto as Exhibit B.

6. REPRESENTATIONS, WARRANTIES, AND DISCLAIMERS
6.1 Validation Warranty: Provider warrants that pipeline execution engines produce deterministic variant call outputs matching
validated benchmark VCF digests under identical reference genome builds (GRCh38.p14).
6.2 DISCLAIMER: EXCEPT FOR EXPRESS WARRANTIES IN SECTION 6.1, THE PLATFORM IS PROVIDED “AS IS” FOR CLIA/CAP DIRECT-
OVERSIGHT INTERPRETATION. PLATFORM VARIANT ANNOTATIONS DO NOT CONSTITUTE INDEPENDENT BOARD-CERTIFIED
MEDICAL DIAGNOSES.

7. INDEMNIFICATION FRAMEWORK
7.1 Provider IP Defense: Provider shall defend and indemnify Customer against third-party patent or copyright infringement claims
arising directly from authorized production use of the SaaS Platform, paying final awarded damages or settlement costs approved by
Provider.

8. LIMITATION OF LIABILITY
8.1 CONSEQUENTIAL DAMAGES EXCLUSION: NEITHER PARTY SHALL BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, PUNITIVE,
OR CONSEQUENTIAL DAMAGES, INCLUDING LOST CLINICAL REIMBURSEMENTS, SPECIMEN RE-EXTRACTION COSTS, OR
REGULATORY WARNING LETTERS, EVEN IF ADVISED OF FORESEEABILITY.
8.2 AGGREGATE LIABILITY CAP: EXCEPT FOR BAA/HIPAA BREACHES, CONFIDENTIALITY (SECTION 5), IP INDEMNIFICATION
(SECTION 7.1), OR GROSS NEGLIGENCE, EACH PARTY’S TOTAL CUMULATIVE LIABILITY ARISING UNDER THIS AGREEMENT SHALL
NOT EXCEED TOTAL SUBSCRIPTION FEES ACTUALLY PAID BY CUSTOMER TO PROVIDER IN THE TWELVE (12) MONTHS PRECEDING
THE CLAIM EVENT.

9. TERM, SUSPENSION, AND TERMINATION
9.1 Term & Termination: Commences Effective Date and continues through active Order Forms. Either Party may terminate for
material un-cured breach after 30 days (10 days non-payment). Within 45 days post-termination, Customer may request full
encrypted export of VCF/FASTQ run archives via signed S3 URIs prior to certified cryptographic deletion.

10. GOVERNING LAW AND EXECUTION
10.1 Controlling Jurisprudence: Delaware law; exclusive venue Wilmington, DE state/federal courts. Executed in electronic
counterparts via ESIGN/UETA compliant PKI signatures.

 IN WITNESS WHEREOF, AUTHORIZED CORPORATE OFFICERS EXECUTE THIS MASTER AGREEMENT AS OF NOVEMBER 1, 2026.

 FOR PROVIDER:                                                       FOR CUSTOMER:
 Synthesis BioAnalytics Inc.                                         Genomix Clinical Diagnostics LLC
 Signature: /s/ Dr. Alistair Thorne | Name: Alistair Thorne, PhD |   Signature: /s/ Dr. Maya Lin | Name: Maya Lin, MD, PhD | Title: Lab
 Title: CEO | Date: Nov 1, 2026                                      Director | Date: Nov 1, 2026




CONFIDENTIAL — SYNTHESIS BIOANALYTICS INC. / GENOMIX CLINICAL LABS LLC                                                          Page 2 of 4
AT TA C H M E N T A — O R D E R F O R M & C O M M E R C I A L S C H E D U L E

CLINICAL SAAS SUBSCRIPTION ORDER FORM (OF-2026-SYN-7718)



        ORDER REF               OF-2026-SYN-7718 (Exec V2)                       EFFECTIVE TERM        Nov 1, 2026 – Oct 31, 2028 (24 Months)

        BILLING
                                Annual Advance ($245,000/yr Net 30)              ACCOUNT AE            Claire Sterling (c.sterling@synthesisbio.com)
        SCHEDULE


       SKU / Platform                                                                                            Unit Price       Extended Annual
                                   Tier / Scope Description                                   Qty / Units
       Module                                                                                                        (USD)                  (USD)

       SYN-CLIA-
                                   HelixFlow CLIA/CAP Multi-Tenant Variant Calling Suite           2 Sites       $82,000.00             $164,000.00
       ENTERPRISE

                                   High-Throughput Whole Exome/Genome Tier (Up to                   50K
       SYN-NGS-THRU-50K                                                                                      $1.18 / sample              $59,000.00
                                   50,000 samples/yr)                                            Samples

                                   IQ/OQ/PQ Computerized System Validation Evidence
       SYN-VALID-PKG-GXP                                                                       1 Package         $14,800.00              $14,800.00
                                   Artifact Package

       PROF-BIOINFO-               Dedicated Clinical Bioinformatics Engineering Support
                                                                                                40 Hours        $180.00 / hr               $7,200.00
       CONSULT                     Hours

                                                                                Total Annual Contract Value (ACV — USD):                $245,000.00


        GOVERNING SCOPE & COMMERCIAL EXCEPTIONS:
        1. Specimen Tier Overtaking: Tier 2 overage billed quarterly at $1.35/sample.
        2. BAA Execution: HIPAA BAA attached as Exhibit B governs PHI ingress.
        3. Designated Cloud Region: AWS us-west-2 (Oregon) HIPAA-eligible enclave with customer-managed KMS.
        4. Payment Remittance: Wire/ACH payable to Synthesis BioAnalytics Inc., Silicon Valley Bank, Routing #121107826, Acct #8892-3310-9100.


        ORDER FORM ACCEPTANCE AND AUTHORIZATION

        Synthesis BioAnalytics Acceptance:                                      Genomix Clinical Diagnostics Acceptance:
        Signature: /s/ Claire Sterling | Director Life Sciences Sales | Date:   Signature: /s/ Dr. Marcus Vance | COO Genomix Diagnostics | Date:
        Nov 1, 2026                                                             Nov 1, 2026




      CONFIDENTIAL — SYNTHESIS BIOANALYTICS INC. / GENOMIX CLINICAL LABS LLC                                                               Page 3 of 4
AT TA C H M E N T B — G X P R E L I A B I L I T Y, S L A & H I P A A B A A E X H I B I T

CLINICAL RELIABILITY & SECURITY EXHIBIT (SLA-2026-SYN-4102)



      This Service Level Agreement (“SLA”) forms an integral part of Master Subscription Agreement MSA-2026-SYN-4102 by and between
      Synthesis BioAnalytics Inc. (“Provider”) and Genomix Clinical Diagnostics LLC (“Customer”).

      1. AVAILABILITY COMMITMENT & MEASUREMENT

        Monthly Uptime Calculation Formula
        Uptime % = [(Total Calendar Minutes − Unscheduled Pipeline Downtime Minutes) ÷ Total Calendar Minutes] × 100
        Target Commitment: Provider guarantees monthly platform availability of 99.95% (“Service Commitment”). Validated maintenance
        windows communicated ≥96 hours prior are excluded.


      2. SERVICE CREDIT SCHEDULE

        Monthly Measured Availability %                             Service Credit Percentage (% of Monthly Platform Fee*)

        99.8% to < 99.95%                                                                                                                      15% Credit

        99.5% to < 99.8%                                                                                                                       30% Credit

        < 99.5%                                                                                                                                50% Credit

      *Service Credits apply exclusively to recurring SaaS platform license fees and are credited against subsequent quarterly invoices upon Customer written
      request submitted within fifteen (15) days of month-end.

      3. CLINICAL INCIDENT RESPONSE & SEVERITY CLASSIFICATION

                                                                                               Initial Response
        Severity Level        Definition                                                                               Mitigation / Update Cadence
                                                                                               Target

        Severity 1            Complete pipeline execution outage preventing CLIA                      ≤ 20 Minutes     Status update every 30 minutes
        (Critical)            diagnostic batch turn-around or authentication lockout.             (24/7/365 On-Call)   until clinical pipeline active.

        Severity 2            Variant annotation reference sync delay (>12 hours lag)
                                                                                                ≤ 2 Business Hours     Status update every 4 hours.
        (High)                or export manifest formatting discrepancy.

        Severity 3            Non-blocking UI telemetry filtering lag or cosmetic report             ≤ 24 Business     Resolved in validated monthly
        (Standard)            header sorting variance.                                                      Hours      maintenance window.

      4. SECURITY, HIPAA & AUDIT GOVERNANCE
      4.1 Encryption & Isolation: Patient FASTQ/VCF files are encrypted at rest using AES-256 via customer-managed AWS KMS keys. In-
      transit traffic enforces TLS 1.3 with mTLS for variant ingress endpoints.
      4.2 Compliance & Audit Attestations: Provider maintains annual SOC 2 Type II, ISO/IEC 27001:2022, and CLIA/CAP software
      verification compliance artifacts available under NDA inspection.
      4.3 HIPAA Breach Notification Protocol: Confirmed security incidents involving unauthorized PHI exposure shall be reported in
      writing to Customer Security Officer (security@genomixdx.com) within twenty-four (24) hours of forensic verification.

        EXHIBIT CONFIRMATION — CLINICAL RELIABILITY & BAA ATTACHMENT B

        Synthesis BioAnalytics CISO:                                             Genomix Clinical Diagnostics CSO:
        Signature: /s/ Dr. Elena Rostova | Elena Rostova, CISO | Date:           Signature: /s/ Dr. Ravi Kumar | Ravi Kumar, Chief Science Officer | Date:
        Nov 1, 2026                                                              Nov 1, 2026




      CONFIDENTIAL — SYNTHESIS BIOANALYTICS INC. / GENOMIX CLINICAL LABS LLC                                                                     Page 4 of 4

`;
