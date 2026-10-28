-- 014: Open positions board ---------------------------------------------------
-- Everyone signed in can read. Admins (and users listed in positions_editors,
-- e.g. Deepak) can add / edit / remove. Only admins can change priority.

create table if not exists public.positions_editors (
  user_id uuid primary key references public.profiles(id) on delete cascade
);
alter table public.positions_editors enable row level security;
drop policy if exists "read editors" on public.positions_editors;
create policy "read editors" on public.positions_editors for select to authenticated using (true);

insert into public.positions_editors (user_id)
  select id from public.profiles where lower(email) = 'deepak.v@chiparama.com'
  on conflict do nothing;

create or replace function public.can_edit_positions()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(current_app_role() in ('super_admin','admin'), false)
      or exists (select 1 from positions_editors where user_id = auth.uid())
$$;
grant execute on function public.can_edit_positions() to authenticated;
revoke execute on function public.can_edit_positions() from anon, public;
grant execute on function public.can_edit_positions() to authenticated;

create table if not exists public.open_positions (
  id            uuid primary key default gen_random_uuid(),
  sno           int,
  title         text not null,
  location      text,
  employment    text,
  work_mode     text,
  client        text,
  bill_rate     text,
  description   text,
  status        text not null default 'open' check (status in ('open','active','pending','on_hold')),
  priority      text not null default 'normal' check (priority in ('normal','high','urgent')),
  added_at      timestamptz not null default now(),
  added_by      uuid references public.profiles(id) on delete set null,
  added_by_name text,
  updated_at    timestamptz not null default now(),
  updated_by_name text,
  priority_updated_at timestamptz,
  priority_updated_by_name text,
  removed_at    timestamptz,
  removed_by_name text,
  removed_reason text
);
create index if not exists open_positions_active_idx on public.open_positions (removed_at, priority, added_at desc);
alter table public.open_positions enable row level security;
drop policy if exists "read positions" on public.open_positions;
create policy "read positions" on public.open_positions for select to authenticated using (true);

create table if not exists public.open_position_log (
  id          uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.open_positions(id) on delete cascade,
  action      text not null check (action in ('added','edited','removed','restored','priority')),
  changes     jsonb not null default '{}'::jsonb,
  note        text,
  actor       uuid,
  actor_name  text,
  created_at  timestamptz not null default now()
);
create index if not exists open_position_log_idx on public.open_position_log (position_id, created_at desc);
alter table public.open_position_log enable row level security;
drop policy if exists "read position log" on public.open_position_log;
create policy "read position log" on public.open_position_log for select to authenticated using (true);

create or replace function public._pos_actor() returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(full_name,''), email) from profiles where id = auth.uid()
$$;
revoke all on function public._pos_actor() from public, anon, authenticated;

-- Notify admins and position editors (except the actor)
create or replace function public._pos_notify(p_kind text, p_title text, p_body text)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, title, body, link)
  select distinct id, p_kind, p_title, p_body, '/positions' from profiles
   where id is distinct from auth.uid()
     and (role in ('super_admin','admin') or id in (select user_id from positions_editors))
$$;
revoke all on function public._pos_notify(text,text,text) from public, anon, authenticated;

-- Add / edit (priority is NOT touched here; admins set it on create only)
create or replace function public.save_position(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id; v_old open_positions; v_new open_positions;
  v_name text := _pos_actor(); v_diff jsonb := '{}'::jsonb; k text;
  v_prio text := coalesce(nullif(p->>'priority',''), 'normal');
  v_keys text[] := array['title','location','employment','work_mode','client','bill_rate','description','status'];
begin
  if not can_edit_positions() then raise exception 'Not allowed'; end if;
  if coalesce(trim(p->>'title'),'') = '' then raise exception 'Position title is required'; end if;
  if v_id is null then
    if current_app_role() not in ('super_admin','admin') then v_prio := 'normal'; end if;
    if v_prio not in ('normal','high','urgent') then v_prio := 'normal'; end if;
    insert into open_positions (title, location, employment, work_mode, client, bill_rate, description, status, priority, added_by, added_by_name, updated_by_name)
    values (trim(p->>'title'), nullif(trim(p->>'location'),''), nullif(trim(p->>'employment'),''), nullif(trim(p->>'work_mode'),''),
            nullif(trim(p->>'client'),''), nullif(trim(p->>'bill_rate'),''), nullif(trim(p->>'description'),''),
            coalesce(nullif(p->>'status',''),'open'), v_prio, auth.uid(), v_name, v_name)
    returning id into v_id;
    insert into open_position_log (position_id, action, note, actor, actor_name) values (v_id, 'added', null, auth.uid(), v_name);
    perform _pos_notify('position_added', 'New open position', coalesce(v_name,'Someone') || ' added ' || trim(p->>'title') || coalesce(' · ' || nullif(trim(p->>'client'),''), ''));
    return v_id;
  end if;
  select * into v_old from open_positions where id = v_id for update;
  if not found then raise exception 'Position not found'; end if;
  update open_positions set
    title = trim(p->>'title'),
    location = nullif(trim(p->>'location'),''),
    employment = nullif(trim(p->>'employment'),''),
    work_mode = nullif(trim(p->>'work_mode'),''),
    client = nullif(trim(p->>'client'),''),
    bill_rate = nullif(trim(p->>'bill_rate'),''),
    description = nullif(trim(p->>'description'),''),
    status = coalesce(nullif(p->>'status',''), v_old.status),
    updated_at = now(), updated_by_name = v_name
  where id = v_id returning * into v_new;
  foreach k in array v_keys loop
    if to_jsonb(v_old)->k is distinct from to_jsonb(v_new)->k and k <> 'description' then
      v_diff := v_diff || jsonb_build_object(k, jsonb_build_array(to_jsonb(v_old)->k, to_jsonb(v_new)->k));
    elsif k = 'description' and v_old.description is distinct from v_new.description then
      v_diff := v_diff || jsonb_build_object('description', jsonb_build_array('(changed)', '(changed)'));
    end if;
  end loop;
  if v_diff <> '{}'::jsonb then
    insert into open_position_log (position_id, action, changes, actor, actor_name) values (v_id, 'edited', v_diff, auth.uid(), v_name);
  end if;
  return v_id;
end $$;
grant execute on function public.save_position(uuid, jsonb) to authenticated;
revoke execute on function public.save_position(uuid, jsonb) from anon, public;
grant execute on function public.save_position(uuid, jsonb) to authenticated;

create or replace function public.remove_position(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text := _pos_actor(); v_title text;
begin
  if not can_edit_positions() then raise exception 'Not allowed'; end if;
  update open_positions set removed_at = now(), removed_by_name = v_name, removed_reason = nullif(trim(p_reason),''), updated_at = now(), updated_by_name = v_name
   where id = p_id and removed_at is null returning title into v_title;
  if not found then raise exception 'Position not found or already removed'; end if;
  insert into open_position_log (position_id, action, note, actor, actor_name) values (p_id, 'removed', nullif(trim(p_reason),''), auth.uid(), v_name);
  perform _pos_notify('position_removed', 'Position removed', coalesce(v_name,'Someone') || ' removed ' || v_title);
end $$;
grant execute on function public.remove_position(uuid, text) to authenticated;
revoke execute on function public.remove_position(uuid, text) from anon, public;
grant execute on function public.remove_position(uuid, text) to authenticated;

create or replace function public.restore_position(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text := _pos_actor();
begin
  if not can_edit_positions() then raise exception 'Not allowed'; end if;
  update open_positions set removed_at = null, removed_by_name = null, removed_reason = null, updated_at = now(), updated_by_name = v_name
   where id = p_id and removed_at is not null;
  if not found then raise exception 'Position not found or not removed'; end if;
  insert into open_position_log (position_id, action, actor, actor_name) values (p_id, 'restored', auth.uid(), v_name);
end $$;
grant execute on function public.restore_position(uuid) to authenticated;
revoke execute on function public.restore_position(uuid) from anon, public;
grant execute on function public.restore_position(uuid) to authenticated;

-- Priority: admins only
create or replace function public.set_position_priority(p_id uuid, p_priority text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text := _pos_actor(); v_old text; v_title text;
begin
  if current_app_role() not in ('super_admin','admin') then raise exception 'Only admins can change priority'; end if;
  if p_priority not in ('normal','high','urgent') then raise exception 'Invalid priority'; end if;
  select priority, title into v_old, v_title from open_positions where id = p_id and removed_at is null for update;
  if not found then raise exception 'Position not found'; end if;
  if v_old = p_priority then return; end if;
  update open_positions set priority = p_priority, priority_updated_at = now(), priority_updated_by_name = v_name, updated_at = now(), updated_by_name = v_name where id = p_id;
  insert into open_position_log (position_id, action, changes, note, actor, actor_name)
    values (p_id, 'priority', jsonb_build_object('priority', jsonb_build_array(v_old, p_priority)), nullif(trim(p_note),''), auth.uid(), v_name);
  perform _pos_notify('position_priority', v_title || ' is now ' || p_priority || ' priority', coalesce(v_name,'An admin') || ' changed priority from ' || v_old);
end $$;
grant execute on function public.set_position_priority(uuid, text, text) to authenticated;
revoke execute on function public.set_position_priority(uuid, text, text) from anon, public;
grant execute on function public.set_position_priority(uuid, text, text) to authenticated;

-- Seed from Open_Positions.csv (typos cleaned; "Open (Priority)" -> priority high)
with seed(sno,title,location,employment,work_mode,client,bill_rate,description,status,priority) as (values
(1,$q$IP Verification$q$,$q$Austin, TX$q$,$q$Contract$q$,$q$Hybrid$q$,$q$NXP$q$,$q$$110$q$,$q$Own IP-level verification: test plans, SystemVerilog/UVM testbenches, tests, assertions & coverage closure
Constrained-random, coverage-driven verification; debug RTL & testbench failures (VCS/Verdi)
Work with design & architecture teams; maintain reusable, scalable DV environments
3-8 yrs ASIC/IP DV; BS/MS EE/ECE/CS; SystemVerilog, UVM, SVA, AMBA AXI/AHB/APB; Python/Perl
Nice to have: formal, power-aware/GLS verification, protocol IP (PCIe, Ethernet, USB)$q$,'open','normal'),
(2,$q$SOC Verification$q$,$q$Austin, TX$q$,$q$Contract$q$,$q$Hybrid$q$,$q$NXP$q$,$q$$110$q$,$q$Define SoC-level verification scope from specs; build test plans, tests & verification infrastructure
Processor-based SoC verification in mixed environments (C/C++ tests on CPU + SystemVerilog/UVM)
SVA, code/toggle/functional coverage; integrate 3rd-party VIP; coordinate with architects, design & post-silicon teams
5+ yrs IP/SoC DV; BS/MS EE/ECE/CS; AMBA AXI; VCS/Verdi; Shell/Perl/Makefile scripting
Nice to have: high-speed IP (PCIe, UFS, Ethernet), gate-level sim, low-power verification$q$,'open','normal'),
(3,$q$IP Verification$q$,$q$India$q$,$q$Contract$q$,$q$Hybrid$q$,$q$NXP$q$,$q$$110$q$,$q$Own IP-level verification: test plans, SystemVerilog/UVM testbenches, tests, assertions & coverage closure
Constrained-random, coverage-driven verification; debug RTL & testbench failures (VCS/Verdi)
Work with design & architecture teams; maintain reusable, scalable DV environments
3-8 yrs ASIC/IP DV; BE/BTech or ME/MTech ECE; SystemVerilog, UVM, SVA, AMBA AXI/AHB/APB; Python/Perl
Nice to have: formal, power-aware/GLS verification, protocol IP (PCIe, Ethernet, USB)$q$,'open','normal'),
(4,$q$SOC Verification$q$,$q$India$q$,$q$Contract$q$,$q$Hybrid$q$,$q$NXP$q$,$q$$110$q$,$q$Define SoC-level verification scope from specs; build test plans, tests & verification infrastructure
Processor-based SoC verification in mixed environments (C/C++ tests on CPU + SystemVerilog/UVM)
SVA, code/toggle/functional coverage; integrate 3rd-party VIP; coordinate with architects, design & post-silicon teams
5+ yrs IP/SoC DV; BE/BTech or ME/MTech ECE; AMBA AXI; VCS/Verdi; Shell/Perl/Makefile scripting
Nice to have: high-speed IP (PCIe, UFS, Ethernet), gate-level sim, low-power verification$q$,'open','normal'),
(5,$q$Formal Verification$q$,$q$USA/India$q$,$q$Contract$q$,$q$Remote$q$,$q$Chiparama$q$,$q$Open rate$q$,$q$Build formal verification environments for control & datapath logic in CPU/SoC blocks
Write formal properties & models (SVA), run proofs, debug counterexamples and feed fixes back to design
JasperGold / VC Formal: FPV, sequential equivalence, connectivity, X-prop; drive formal methodology & sign-off
5+ yrs formal verification; MS EE/CS preferred; strong digital design & CPU architecture knowledge
Verilog/SystemVerilog, SVA/PSL; Tcl/Python/Perl scripting$q$,'open','normal'),
(6,$q$DFT Engineer$q$,$q$San Jose, CA$q$,$q$Full Time$q$,$q$Onsite$q$,$q$Broadcom$q$,$q$$110$q$,$q$Define & implement DFT architecture: scan insertion, compression, boundary scan (JTAG), MBIST
Run ATPG, fault simulation & test coverage analysis to meet manufacturing test goals
Integrate DFT into RTL & gate netlists; work with PD on DFT-friendly layout; support ATE patterns & silicon bring-up
5+ yrs DFT; BS/MS EE/CE; Tessent, Synopsys DFT Compiler/TestMAX, SpyGlass DFT
Python/Tcl/Shell scripting; nice to have: hierarchical DFT on large SoCs, ISO 26262$q$,'open','normal'),
(7,$q$STA Engineer$q$,$q$San Jose, CA$q$,$q$Full Time$q$,$q$Onsite$q$,$q$Broadcom$q$,$q$$110$q$,$q$Static timing analysis & timing closure for cores and full-chip SoCs; enforce timing sign-off criteria
Develop & validate timing constraints (SDC) and timing models; hierarchical STA on large SoCs
Analyze P&R netlists, give PPA feedback to RTL/synthesis/PD teams, and generate timing ECOs
4+ yrs STA; BS/MS EE; PrimeTime or Tempus; ECO tools (PrimeClosure, Tweaker, Tempus ECO); RTL-to-GDS flow
Python/Tcl/Perl automation; nice to have: extraction & circuit simulation, parametric yield$q$,'open','normal'),
(8,$q$Physical Design Engineer$q$,$q$San Jose, CA$q$,$q$Full Time$q$,$q$Onsite$q$,$q$Broadcom$q$,$q$$110$q$,$q$Block/subsystem physical implementation: synthesis, floorplan, place & route, CTS through sign-off
Meet aggressive PPA targets on complex SoCs at advanced nodes; timing, IR/EM & DRC/LVS closure
Low-power implementation: UPF, multi-voltage domains, power gating; IP integration
5+ yrs physical design; BS/MS EE; Innovus / Fusion Compiler / ICC2, PrimeTime, Calibre
Tcl/Python automation to improve PPA & turnaround; deep sub-micron & circuit design understanding$q$,'open','normal'),
(11,$q$Verification Engineer$q$,$q$Bay/Austin$q$,$q$Contract$q$,$q$Hybrid$q$,$q$Baya System$q$,$q$$110$q$,$q$Verify complex digital IP & subsystems (interconnect/NoC, cache-coherent fabrics) from spec to sign-off
Write test plans; build SystemVerilog/UVM testbenches, scoreboards, checkers & assertions
Constrained-random tests, functional/code coverage closure, RTL debug with design & architecture teams
3+ yrs ASIC DV; BS/MS EE/CE/CS; SystemVerilog, UVM, SVA; AMBA AXI/CHI protocols
Python/Perl scripting; nice to have: formal verification, cache coherency, performance verification$q$,'open','normal'),
(12,$q$CPU Verification$q$,$q$Bay/Austin$q$,$q$Contract$q$,$q$Hybrid$q$,$q$Tenstorrent$q$,$q$$110$q$,$q$Verify CPU core microarchitecture features (fetch/decode, execution, load-store, caches/MLC) for logical correctness
Build verification environments, checkers & reference-model comparison; drive coverage closure
Define & debug features with architecture, RTL and post-silicon validation teams
3+ yrs RTL logic verification; BS/MS EE/CE; SystemVerilog/UVM, C/C++, assembly-level tests
ISA knowledge (RISC-V / x86 / Arm); Python/Perl; constrained-random & coverage-driven methodology$q$,'open','normal'),
(13,$q$Formal Verification$q$,$q$Remote$q$,$q$Contract$q$,$q$Hybrid$q$,$q$Samsung$q$,$q$Open rate$q$,$q$Build formal verification environments for control & datapath logic in CPU/SoC blocks
Write formal properties & models (SVA), run proofs, debug counterexamples and feed fixes back to design
JasperGold / VC Formal: FPV, sequential equivalence, connectivity, X-prop; drive formal methodology & sign-off
5+ yrs formal verification; MS EE/CS preferred; strong digital design & CPU architecture knowledge
Verilog/SystemVerilog, SVA/PSL; Tcl/Python/Perl scripting$q$,'open','normal'),
(14,$q$RTL Integration$q$,$q$Bay/Austin$q$,$q$Contract$q$,$q$Hybrid$q$,$q$einfochip$q$,$q$Open rate$q$,$q$Integrate IPs into SoC/subsystem top level: connectivity, clocks, resets, interrupts, power domains
Run front-end quality checks: Lint, CDC, RDC, Comp-Elab; resolve integration issues
Support synthesis, timing constraints and handoffs to DV & physical design teams
2+ yrs VLSI front-end design; BS/MS EE/ECE; Verilog/SystemVerilog; strong front-end ASIC flow
Perl/Python, Shell, Makefiles; Git/ClearCase version control$q$,'open','normal'),
(15,$q$SOC DV$q$,$q$Bay/Austin$q$,$q$Contract$q$,$q$Onsite$q$,$q$Meta$q$,$q$$110$q$,null,'open','normal'),
(16,$q$Validation Technician$q$,$q$Palo Alto, CA$q$,$q$Contract$q$,$q$Onsite$q$,$q$Rivian$q$,$q$$51.03 - $67.49/hr$q$,$q$Job ID 3746 | Nov 2, 2026 - Feb 1, 2027 | 100% onsite, 607 Hansen Way, Palo Alto | 40-45 hrs/wk
Must have: oscilloscopes, power supplies, DMMs; basic Python; Jira
Test procedures & hardware bring-up for Rivian Autonomous Processor (post-silicon validation)
Environmental/electrical testing, thermal chambers, custom test fixtures, failure troubleshooting
7+ yrs ATE / industrial automation; soldering & PCB rework; reads schematics
Nice to have: automotive instrumentation$q$,'active','normal'),
(17,$q$Senior Development Operations Engineer (Data Science)$q$,$q$Normal, IL / Remote$q$,$q$Contract$q$,$q$Remote/Hybrid$q$,$q$Rivian$q$,$q$$82.33 - $108.88/hr (Non-US remote: max $40/hr)$q$,$q$Job ID 3745 | Oct 26, 2026 - Apr 22, 2027 | Remote or onsite (Normal, IL) | 40 hrs/wk, 9-6 CT
Staff AI/ML Engineer & Data Scientist - production ML for predictive maintenance (manufacturing, sensor, PLC data)
Must have: Databricks MLOps/AI-ML (2-3 yrs data architect), AWS MLOps, Python, CI/CD, SQL/NoSQL
Traditional ML (regression, tree models, clustering, forecasting, anomaly detection); MLflow, scikit-learn, XGBoost
8+ yrs applied ML/data science (3+ senior/staff), 5+ yrs software dev; Master's or PhD required
Nice to have: Golang, RAG/vector DBs, Spark/Ray, time-series$q$,'pending','normal'),
(18,$q$Senior Automation Controls Engineer$q$,$q$Toledo, OH$q$,$q$Contract$q$,$q$Onsite$q$,$q$Rivian$q$,$q$$77.67 - $102.72/hr (target $84 + expenses)$q$,$q$Job ID 3727 | 2 openings | Oct 12, 2026 - Jul 12, 2027 | Onsite Toledo, OH (4100 Bennett Rd), not Normal, IL
72 hrs/wk, rotating 12-hr day/night shifts (6am-6pm / 6pm-6am) every 2-4 weeks
Must be a Controls Engineer (NOT Robot Engineer) with automotive Body Shop experience
PLC (Rockwell/Siemens/Beckhoff, ladder & structured text), HMI (FactoryTalk/Ignition), safety PLCs, MES, Ethernet/IP, Profinet
5-7 yrs controls engineering; BS/MS EE; ANSI/RIA 15.06, OSHA, NFPA79; EPLAN/AutoCAD Electrical; FAT/SAT buy-offs
Nice to have: 6-axis robot troubleshooting (Fanuc, ABB, Kawasaki)$q$,'active','normal'),
(19,$q$Senior Validation Technician$q$,$q$Palo Alto, CA$q$,$q$Contract$q$,$q$Onsite$q$,$q$Rivian$q$,$q$$63.79 - $84.36/hr$q$,$q$Job ID 3711 | Oct 19, 2026 - Oct 18, 2027 (can start earlier) | Onsite, 607 Hansen Way, Palo Alto | 45 hrs/wk, some OT
Must have: digital oscilloscopes, humidity chambers, thermal testing, chillers; high-voltage safety
Run thermal, vibration, humidity, corrosion & electrical tests on HV power electronics; write test reports
Install instrumentation (thermocouples, strain gauges, accelerometers); build test equipment, fixtures & harnesses
3+ yrs environmental validation & test-harness fabrication; soldering; reads schematics; up to 20% travel
Submission: answer each skill (Excel/SQL/Python/Jira, PLM, UAT, chillers) directly; do not alter resume$q$,'active','normal'),
(20,$q$Electronics Lab Technician$q$,$q$Irvine, CA$q$,$q$Contract$q$,$q$Onsite$q$,$q$Rivian (RV Tech)$q$,$q$$40.32 - $53.32/hr$q$,$q$Job ID 3683 (extra headcount for req 3613) | Oct 12, 2026 - Apr 9, 2027 | Onsite, 14410 Myford Rd, Irvine | 40 hrs/wk
PCBA rework, fine-pitch & 0402 soldering, blue-wire mods per IPC-610 Class 3; harness builds per IPC/WHMA-A-620
Functional testing of circuit assemblies & prototypes, ECU module assembly, custom test setups, root-cause troubleshooting
Also handles shipping/receiving, inventory & kitting, test records
3+ yrs electronics lab technician; tech degree or equivalent; multimeters, oscilloscopes, e-loads; MS Office
Nice to have: EV experience, Jira, Python, IPC-610/620/7711/7721 or J-STD-001 certification$q$,'active','normal'),
(21,$q$Senior Engineer (Supply Chain) - Sr. Material Flow Engineer$q$,$q$Normal, IL$q$,$q$Contract$q$,$q$Onsite$q$,$q$Rivian$q$,$q$$62.39 - $82.51/hr$q$,$q$Job ID 3619 (replaces 3595) | 1 of 2 still open | Aug 3, 2026 - Aug 2, 2027 | Onsite Normal, IL | 8-5, 45 hrs/wk, some travel
Design end-to-end material flow & logistics from external warehouses to assembly line (value stream, routing, warehouse design)
Implement conveyors, EMS, AGVs, ASRS; cost/throughput/space models; lead AI-driven logistics automation
BS Supply Chain/Industrial Eng; 5+ yrs supply chain or material flow engineering in high-volume production
3+ yrs layout planning (AutoCAD/MicroStation); 1+ yr simulation (FlexSim/AnyLogic) & Power BI/Tableau
Nice to have: MBA/MS, PMP or APICS, 7+ yrs, MES/MRP/WMS/YMS, Python, automotive experience$q$,'active','normal'),
(22,$q$Mechanical Designer (SolidWorks)$q$,$q$Mesa, AZ$q$,$q$Contract$q$,null,$q$Xnergy (via HCL)$q$,$q$$50/hr all-inc$q$,$q$Expert SolidWorks: parametric parts, large assemblies (1000s of parts), sheet metal, weldments, configurations
Large-assembly performance: Large Design Review, Lightweight, SpeedPak, simplified reps
Teamcenter PLM: ECR/ECO/ECN, EBOM/MBOM, revision control, release to manufacturing
Production drawings with ASME Y14 GD&T, tolerance stacks, DFM/DFA; prototype support
8+ yrs mechanical design (BS ME); start immediately | Nice to have: HVAC/AHU/chillers, DFMEA$q$,'open','high'),
(23,$q$Lead Electrical Engineer$q$,$q$Mesa, AZ$q$,$q$Contract$q$,null,$q$Xnergy (via HCL)$q$,$q$$50/hr$q$,$q$Electrical design for data center HVAC & liquid cooling: control panels, power distribution, harnesses
Single/three-line drawings, schematics, 3D electrical models, BOMs; panel heat-run & water-leak tests
NEC, UL 60335-2-40, UL 508, NFPA compliance; integrate with mechanical & refrigerant systems
BSEE (or Assoc. + 5 yrs); SolidWorks Electrical / AutoCAD Electrical; VFDs, motor control, contactors
Lead NPD/ETO projects; up to 15% travel | Nice to have: short-circuit, harmonic & power system studies$q$,'open','high'),
(24,$q$Electro-Mechanical Designer$q$,$q$Mesa, AZ$q$,$q$Contract / Full Time$q$,null,$q$Xnergy (via HCL)$q$,$q$$50/hr all-inc$q$,$q$Design electro-mechanical enclosures, electrical cabinets & control panels for data center liquid cooling
3D models, manufacturing drawings, assembly layouts; cable routing, connectors, thermal management
Sheet metal design, GD&T, material selection, fastening; DFM/DFA & cost optimization
IP/NEMA ratings, UL, NEC, NFPA; prototyping & design validation
BS ME (or equivalent) + 5 yrs; hands-on SolidWorks$q$,'open','high'),
(25,$q$Senior Mechanical Engineer$q$,$q$Milpitas, CA$q$,$q$Contract$q$,null,$q$KLA (via HCL)$q$,$q$$70/hr$q$,$q$Vacuum system design for semiconductor equipment; vacuum materials & fabrication
Concept & detailed design in Creo (Pro/E); large assemblies & system layout with reference geometry
Machining, welding & sheet metal process knowledge; engineering materials
Onsite-offshore coordination; AutoCAD; Enovia/Windchill PLM; Visio & MS Office
Nice to have: SEMI S2/S8, semiconductor domain, reverse engineering$q$,'open','normal'),
(26,$q$Senior Mechanical Engineer - Semiconductor Product Development$q$,$q$Beverly, MA$q$,null,null,$q$Axcelis (via HCL)$q$,$q$$50/hr all-inc (earlier mail: $45/hr)$q$,$q$Lead mechanical design of ion implanter subsystems: process chambers, wafer-handling robots, vacuum
Design calcs, GD&T (ASME Y14.5), tolerance stacks, DfX; FEA/CFD (Creo Simulate/ANSYS) + prototype validation
Precision motion mechanisms & electromechanical assemblies; test plans & engineering documentation
Creo, AutoCAD, Windchill/PLM, ECO/ECR; SEMI S2/S8 compliance
BSME + 5 yrs semiconductor tools / complex electromechanical systems; concept-to-NPI release$q$,'open','high'),
(27,$q$Mechanical FEA Engineer$q$,$q$Fremont, CA$q$,$q$Contract$q$,null,$q$Meta (via HCL)$q$,$q$Open rate$q$,$q$Structural FEA for hardware accelerator module stiffeners (ribs, thickness, mounting, materials)
Mounting-pressure, gravity-sag & handling loads; random vibration, sine sweep, shock, modal & fatigue
Staged PCB/PCBA warpage simulation at room & high temp (CTE mismatch); flag SMT risk
Correlate with shadow-moire, shaker & drop tests; pass/fail reports vs acceptance criteria
5+ yrs structural FEA in electronics/PCBA/packaging; Ansys and/or Altair HyperMesh$q$,'open','high'),
(28,$q$Supplier Quality Engineer$q$,$q$Rice Creek Office, MN$q$,$q$Contract$q$,null,$q$Abbott (via HCL)$q$,$q$$60/hr all-inc$q$,$q$Ensure suppliers deliver compliant parts, materials & services for medical devices
Onboard suppliers to ASL; risk segmentation; supplier quality agreements & audits
Review/approve PPAP: control plans, process flows, capability studies, DFMEA/PFMEA
Approve process validation (IQ/OQ/PQ), MSA/TMV; route docs in PLM; SDR/SOQ with global teams
BS engineering/science + 8+ yrs supplier quality in medical devices$q$,'open','normal'),
(29,$q$Design Engineer - Light / Heavy Structures$q$,$q$Decatur, IL$q$,$q$Contract$q$,null,$q$Caterpillar (via HCL)$q$,$q$$45/hr all-inc$q$,$q$Design heavy structures: chassis & upper frame for off-highway trucks / mining products
Welding & fabrication design; mechanical system integration
Develop & articulate product design concepts; independent problem solving
Creo, Teamcenter, VisMockup; Caterpillar print creation & release process
5-7 yrs with bachelor's; Caterpillar tools/process experience preferred$q$,'open','normal'),
(30,$q$Cryo-Mechanical Lab Engineer$q$,$q$Redmond, WA$q$,$q$Contract$q$,null,$q$Microsoft (via HCL)$q$,$q$$50/hr all-inc$q$,$q$Install & rework cryo-mechanical hardware for dilution refrigerator upgrades (shields, plates, brackets, vacuum)
Execute upgrade procedures; record builds, configuration changes & deviations
Support bring-up: fit checks, thermal anchoring, leak-check readiness, cooldown prep
Hands-on cryogenic, vacuum or research lab experience; precision assembly; ESD & safety
Up to 50% travel (trips up to 2 weeks) | Nice to have: dilution fridges, cryostats, quantum hardware$q$,'open','high'),
(31,$q$Room Temperature Rack Technician / Engineer$q$,$q$Redmond, WA$q$,$q$Contract$q$,null,$q$Microsoft (via HCL)$q$,$q$$50/hr all-inc$q$,$q$Assemble, cable, label & maintain electronics racks for quantum hardware test labs
Install rack instruments, power distribution, RF hardware, patch panels & network gear
First-line debug of instruments, RF paths & networks (DHCP); document rack layouts & cable maps
2+ yrs Python 3.x for instrument control/automation; ESD & electronics lab practices
Lift 40 lbs, work at 8+ ft heights, some travel | Nice to have: RF, physics/EE degree$q$,'open','high'),
(32,$q$Mechanical CAD Engineer$q$,$q$Fremont, CA$q$,$q$Contract$q$,null,$q$Meta (via HCL)$q$,$q$$80/hr all-inc$q$,$q$Creo models & release-quality drawings for hardware accelerator modules with full GD&T & tolerance stacks
Drawing-release packages, ECO/change control; maintain master CAD & BOM in PLM
ECAD/MCAD IDF/IDX exchange (PKO, heatsink/stiffener, KOZ/KIZ); cold-plate & hose routing details
Socket & EVB mechanical detailing; DFM/DFA & serviceability reviews
5+ yrs mechanical design in electronics/server/datacenter hardware; Creo, PLM, ASME Y14.5$q$,'open','high'),
(33,$q$Electrical - Wire Harness Engineer$q$,$q$Mossville, IL$q$,$q$Contract$q$,null,$q$Caterpillar (via HCL)$q$,$q$$45/hr all-inc$q$,$q$Route wiring harnesses for Motor Graders using Creo, Electric Lines & Pro Cabling
Electrical integration for next-gen machine NPI/NTI: harness routing, power distribution, interfaces
3D harness design in Creo & Teamcenter; detailing & print checking
Read electrical drawings & schematics; work with suppliers
BE Mechanical/Electrical + 5-7 yrs | Keywords: Creo Schematics, harness design, cabling$q$,'open','normal'),
(34,$q$Mechanical Design Lead$q$,$q$Allentown, PA$q$,$q$Contract$q$,null,$q$Caterpillar (via HCL)$q$,$q$$60/hr all-inc$q$,$q$NPD for semiconductor/process equipment: concept, detail design, modeling & drawings
Autodesk Inventor, SolidEdge, AutoCAD; large assemblies; machined & sheet metal parts
GD&T, BOM prep, manufacturing drawings, assembly procedure & operation sheets
PDM/PLM (Enovia, Windchill); procure new parts; attend client meetings
Coordinate & guide offshore team; semiconductor domain a plus$q$,'open','normal'),
(35,$q$Industrial Engineer - Robo / Cobo$q$,$q$Decatur, IL$q$,$q$Contract$q$,null,$q$Caterpillar (via HCL)$q$,$q$$50/hr all-inc$q$,$q$5+ yrs with Siemens-controlled CNC machines
Allen-Bradley PLC expertise
Robots: ABB, Fanuc; robot/cobot production shop-floor experience
Heavy-industry manufacturing & fabrication background$q$,'open','normal'),
(36,$q$Mechanical Design Engineer (2 openings)$q$,$q$Fremont, CA$q$,$q$Contract$q$,null,$q$Lam Research (via HCL)$q$,$q$$55/hr all-inc$q$,$q$Semiconductor equipment & industrial automation design; concept generation
Detailed drawings of complex, precise sheet metal & machined parts; GD&T & tolerance stacks
Product structuring & BOM management; DFX & DFMEA; hands-on manufacturing knowledge
Clean-room materials & requirements; read schematics & P&IDs
SolidWorks & AutoCAD | Nice to have: vacuum/gas systems, cooling & water-flow analysis$q$,'open','normal'),
(37,$q$Field Quality & Supplier Quality Engineer (2 openings)$q$,$q$Chaska, MN$q$,$q$Contract$q$,null,$q$Tokyo Electron (via HCL)$q$,$q$$55/hr all-inc$q$,$q$Field failure analysis on customer-identified parts; verify quality issues
RCA with 7QC tools; immediate containment & permanent countermeasures
Hands-on segregation & measurement of on-hold parts; metrology & GD&T
Machining & sheet metal process knowledge
Electronic parts qualification & incoming part approval$q$,'open','normal'),
(38,$q$Mechanical Engineer$q$,$q$Gloucester, MA$q$,$q$Contract$q$,null,$q$AMAT (via HCL)$q$,$q$$60/hr all-inc$q$,$q$Design & update manufacturing drawings in Pro/E-Creo (regular Creo design experience required)
BOMs, drawing packages, redlines; GD&T for mechanical interfaces
ECO/ECN/VPR/QN processing in Agile PLM & Windchill
Onsite build support for semiconductor equipment; DFM/DFS with assembly teams
RCA with 8D, Fishbone, 5 Whys; drive QN closure$q$,'open','normal'),
(39,$q$Project Coordinator / Project Management Analyst$q$,$q$Milwaukee, WI$q$,$q$Contract$q$,null,$q$JCI (via HCL)$q$,$q$$55/hr all-inc$q$,$q$Support BMS team: project plans, schedules, RAID logs & action trackers
Track engineering deliverables (drawings, prototypes, testing, design reviews) & milestones
Coordinate procurement, suppliers & manufacturing; track lead times & shortages; NPI support
Weekly dashboards, KPI reports & exec summaries (Excel, MS Project, Power BI)
BS ME/IE/Mfg + 3-6 yrs PM/engineering coordination; US-hours overlap; PMP/CAPM/Agile a plus$q$,'open','normal'),
(40,$q$Design Engineer - Hydraulics Design and Vehicle Integration$q$,$q$Mossville, IL$q$,$q$Contract$q$,$q$Onsite$q$,$q$Caterpillar (via HCL)$q$,$q$$45/hr all-inc$q$,$q$Mechanical & hydraulic system design; component selection (adapters, hoses)
Platform engineering, vehicle integration & assembly; cooling system design
Creo, Teamcenter, VisMockup, SDP fluid/hydraulic lines; print creation & release
Develop & articulate design concepts; independent problem solving
5-8 yrs with bachelor's; Caterpillar tools & processes; 100% onsite$q$,'open','normal'),
(41,$q$Design Engineer - Engine Installation and Cooling System$q$,$q$Mossville, IL$q$,$q$Contract$q$,$q$Onsite$q$,$q$Caterpillar (via HCL)$q$,$q$$45/hr all-inc$q$,$q$Drive NPI & continuous product improvement for engine installation
Radiator, engine cooling component & engine mounting design
Fuel lines, hose routing, air intake & exhaust mounting; emission norms
Machine packaging/integration; FEA/CFD simulation, testing & validation
Teamcenter, Creo, Fluid Lines, Creo Simulate; 100% onsite$q$,'open','normal'),
(42,$q$Manufacturing Engineer - APQP$q$,$q$Mossville, IL$q$,$q$Contract$q$,$q$Onsite$q$,$q$Caterpillar (via HCL)$q$,$q$$50/hr all-inc$q$,$q$Support enterprise APQP tools: Requirements Management, DFMEA/PFMEA, Control Plans
Gather user feedback, define requirements & prioritize tool/process enhancements
Work with IT & software vendors on issues, releases & deployments; track project status
Build/improve Power BI dashboards; training material & user support
5+ yrs; engineering or CS bachelor's; 100% onsite at Caterpillar Tech Center$q$,'open','normal'),
(43,$q$Product Design Lead / Mechanical Lead$q$,$q$Valley Green, PA$q$,$q$Contract$q$,null,$q$Amphenol (via HCL)$q$,$q$$63/hr all-inc$q$,$q$Design high-speed interconnect/connector products for telecom, datacenter, server & industrial use
Concept to production: requirements, tolerance stacks, material & plating selection, tooling, qualification
Work with Signal & Mechanical Integrity teams; test plans, DFM, cost reduction, customer support
7+ yrs connector design; SolidWorks or Creo, GD&T, FEA; stamping, molding, plating, copper alloys
Preferred: USB, PCIe, QSFP/SFP, DDR connectors | Target cos: TE, Molex, Samtec, Hirose, Aptiv$q$,'open','normal'),
(44,$q$L2 Mechanical Simulation Support$q$,$q$Cupertino, CA$q$,$q$Contract$q$,null,$q$Apple (via HCL)$q$,$q$$65/hr all-inc$q$,$q$Tier-2 support for mechanical simulation tools (ANSA/META, Abaqus, Ansys)
Full workflow: CAD prep, meshing, FEA, result interpretation & design recommendations
Develop simulation methodologies, best practices & validation procedures
Automate workflows with Python/NumPy; support design, test & systems teams
3+ yrs CAE | Nice to have: StarCCM+, Icepak, LS-Dyna, COMSOL, NX/Teamcenter$q$,'open','normal'),
(45,$q$Manufacturing Engineer$q$,$q$Plano, TX$q$,$q$Contract$q$,null,$q$Abbott (via HCL)$q$,$q$$55/hr all-inc$q$,$q$Medical device manufacturing process development, characterization & optimization
Process validation (IQ/OQ/PQ) & PFMEA; Minitab data analysis
DFM; tooling, fixture & equipment design; production troubleshooting
Lean & continuous improvement; RCA; FDA, ISO 13485, GMP compliance
BS ME/Mfg + 3-4 yrs medical device manufacturing engineering$q$,'open','normal'),
(46,$q$Third Party Manufacturers Engineer (TPM) - Medical Device$q$,$q$Plymouth, MN$q$,$q$Contract$q$,null,$q$Abbott (via HCL)$q$,$q$$60/hr all-inc$q$,$q$Lead projects with Third Party Manufacturers (TPMs) for medical devices
Independently manage project scope, cost & schedule
Drive improvements in regulated environments (FDA, ISO, ASTM, USP)
Lead cross-functional global teams; data-driven problem solving
5+ yrs manufacturing engineering (med device pref) incl. 3-5 yrs TPM projects$q$,'open','normal'),
(47,$q$Supplier Quality Engineer - Medical Device$q$,$q$Plymouth, MN$q$,$q$Contract$q$,null,$q$Abbott (via HCL)$q$,$q$$60/hr all-inc$q$,$q$Supplier quality & receiving inspection; create inspection procedures & tools
Component specs, testing & approval; work with Design Eng on selection & reliability
Analyze incoming defects, investigate supplier field failures, lead corrective actions
SAP (QM/SCM) or other ERP; Windchill change orders & BOM updates
5+ yrs (med device pref); FDA, GMP, ISO 13485, ISO 14971$q$,'open','normal'),
(48,$q$Manufacturing Engineer - Medical Device$q$,$q$Plymouth, MN$q$,$q$Contract$q$,$q$Onsite$q$,$q$Abbott (via HCL)$q$,$q$$60/hr all-inc$q$,$q$NPI manufacturing engineering for medical devices
Process development, characterization & validation (IQ/OQ/PQ)
Design test fixtures; develop & validate test and inspection methods
DFM; support tooling & equipment development with cross-functional global teams
BS engineering (ME or related; MS preferred) + 5+ yrs; 100% onsite$q$,'open','normal'),
(49,$q$Sr. Technical Lead - Mechanical Engineer$q$,$q$Nashua, NH$q$,$q$Contract$q$,null,$q$Amphenol (via HCL)$q$,$q$$55/hr all-inc$q$,$q$Design components for stamping, molding & machining; plastic & sheet metal DFM
Creo & SolidWorks: 3D models, sheet metal, 2D drawings, assemblies
GD&T, tolerance stacks, DFMEA, material selection, DFM/DFA
NPI/NPD process & compliance; Windchill PDM/PLM
Lead a team; present to stakeholders & leadership$q$,'open','normal'),
(50,$q$Packaging Engineer$q$,$q$Fremont, CA / Sparks, NV / Austin, TX / Houston, TX$q$,$q$Contract$q$,null,$q$Tesla (via HCL)$q$,$q$$75/hr all-inc$q$,$q$Lead engineered packaging projects for Vehicle & Energy platforms
Design protective containers, dunnage & shipping racks (domestic & international)
CAD, datum structure, GD&T, tolerance stacks; materials (aluminum, steel, composites, foam)
Packaging testing & validation; ASTM/Mil-Spec; expendable-to-returnable & sustainability
Bachelor's (engineering/packaging) or equivalent; vendor & budget mgmt; up to 30% travel$q$,'open','normal')
), ins as (
  insert into public.open_positions (sno,title,location,employment,work_mode,client,bill_rate,description,status,priority,added_by_name,updated_by_name)
  select sno,title,location,employment,work_mode,client,bill_rate,description,status,priority,'Imported','Imported' from seed
  where not exists (select 1 from public.open_positions)
  returning id
)
insert into public.open_position_log (position_id, action, note, actor_name)
select id, 'added', 'Imported from Open_Positions.csv', 'Imported' from ins;
