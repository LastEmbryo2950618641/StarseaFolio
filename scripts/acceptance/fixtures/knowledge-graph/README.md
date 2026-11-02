# Knowledge graph synthetic pilot

`benchmark.json` is the frozen version-1 dataset consumed by the evaluator. It is
original, model-authored Chinese fiction and annotation, with status
`model_authored_pending_human_review`. It is not human gold, an imported public
benchmark, or evidence of production retrieval/answer quality.

## Contents

| Book ID | Story | Split | Chapters | Answerable | Unknown | Total |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `reed-canal` | 苇渠夜汛: canal repairs, flood response and a copper token | `development` | 8 | 34 | 6 | 40 |
| `orbital-seed` | 环站种匣: quarantine, seed inventory and an outage exercise | `development` | 8 | 34 | 6 | 40 |
| `shadow-stage` | 雨棚下的影戏: a traveling shadow-play troupe and a venue change | `holdout` | 8 | 34 | 6 | 40 |
| Total | | | 24 | 102 | 18 | 120 |

There are 33 `multi_hop` cases with explicitly enumerated 2-, 3-, or 4-passage
proofs, nine exact-quotation cases, and additional multi-passage inventory,
historical-state and homonym cases. The 102 positive cases have 105 acceptable
evidence sets containing 187 distinct source/quote requirements counted within
each set. Three final-custody cases allow alternative complete evidence paths.
This requirement count is not a count of unique facts across the dataset.

Each book has an alias and a separate person with a same-sounding Chinese name.
Transfers track physical custody rather than legal ownership; a key holder is
not automatically the custodian of the object inside a cabinet. Time questions
distinguish earlier snapshots from retrospective historical questions. The seed
story explicitly corrects an earlier attributed oral report in chapter five.
Numeric answers are canonical Arabic numerals without units. Quote questions ask
for the quoted words without surrounding quotation marks or terminal punctuation.
Other answers use the exact short name or place specified in `reference_answers`.

## Snapshot And Evidence Rules

`snapshot_chapter` is the inclusive chapter cutoff, with sequences 1 through 8.
Each `source_key` identifies one frozen chapter of one book. Evidence quotes are
verbatim excerpts from its body; all required passages in an `all_of` group must
be retrieved, while different `evidence_sets_any_of` groups are alternatives.
The dataset does not prescribe runtime Source IDs or graph node topology.

The unknown cases have empty reference-answer and evidence arrays. They include
unstated personal details, prices, future outcomes not available at an early
snapshot, unverified rumors, and actions only proposed rather than completed.
An absence of evidence does not establish that a rumored fact is false. Questions
with unsupported premises require abstention rather than an invented numeric
answer. The stage-story planned-copy question asks for its unknown intended page
count, not for the known fact that no copy had yet been started.

Keep books isolated. Use only the two development books when tuning. The holdout
is a local split convention, not a claim that the file is secret or that it was
authored independently by a human. Import only permitted chapter bodies into the
system under test, never this JSON's annotations, reference answers, future
chapters, generator source or this README. Actual source mapping and query-context
isolation still require runner audits; fixture validation cannot establish them.

## Reproduce And Validate

The initial frozen JSON has SHA-256
`e54cdaccfc58b079bba0b03be6a4c3bc4b07fadd2f15f9e28384f41a33ebf46b`.
Direct validation of the serialized file returned the counts above. All 120
reference-answer/evidence inputs passed a scoring consistency check. Removing
each required passage from the 33 multi-hop inputs produced 87 incomplete-proof
checks. These checks do not establish semantic correctness or retrieval quality.

`generate-benchmark.mjs` contains the authored passages and explicit case tuples.
It mechanically expands passage references, validates the object, and serializes
JSON with stable ordering and a final newline. It has no random, model, database,
network, or clock input. It does not synthesize questions from templates. Normal
benchmark execution should read the checked-in JSON, not regenerate it.

From the repository root, verify that the frozen file exactly matches its source:

```sh
node scripts/acceptance/fixtures/knowledge-graph/generate-benchmark.mjs --check
```

To intentionally regenerate after reviewing an annotation edit:

```sh
node scripts/acceptance/fixtures/knowledge-graph/generate-benchmark.mjs
```

Both commands call `validateBenchmark` from the acceptance evaluation library.
Independent validation of the serialized artifact can also be run from the root:

```sh
node --input-type=module -e 'import {readFileSync} from "node:fs"; import {validateBenchmark} from "./scripts/acceptance/lib/knowledge-graph-evaluation.mjs"; console.log(validateBenchmark(JSON.parse(readFileSync("scripts/acceptance/fixtures/knowledge-graph/benchmark.json", "utf8"))))'
```

Validation checks types, IDs, snapshot ranges, source existence and exact quote
presence. It does not certify answer truth, minimal/complete semantic evidence,
absence of alternative valid proofs, or human review. Feeding reference evidence
back into `scoreCase` is only a serialization/scoring consistency check, not a
retrieval experiment or measured system result.

## Representative Cases

| Kind | Case ID | Snapshot | Expected answer | Required chain |
| --- | --- | ---: | --- | --- |
| Single hop | `reed-canal-boat-captain` | 3 | 陶七 | chapter 3 boat/captain statement |
| Alias, 4 passages | `orbital-seed-alias-power` | 2 | 三号电池组 | 纪澄 = 小满 -> 白鸥实验室 -> 乙环 -> power group |
| Multi-hop, 4 passages | `shadow-stage-message-berth` | 6 | 乌桥 | manager messaging rule -> 唐汐 -> 晚芦 -> berth |
| Historical state | `reed-canal-past-owner` | 8 | 陆汀 | chapter 3 custody plus chapter 5 return |
| Current state | `reed-canal-final-owner` | 8 | 梅九 | chapter 8 confirmation OR chapter 7 custody |
| Inventory reasoning | `orbital-seed-returned-count` | 5 | 15 | 24 initial - 5 damaged - 6 removed + 2 returned |
| Unknown future | `reed-canal-unknown-future` | 2 | abstain, empty answer | chapter 8 outcome unavailable at chapter 2 |
| Unknown rumor | `orbital-seed-unknown-vacuum` | 4 | abstain, empty answer | vacuum germination rumor has no completed experiment |
| Unknown price | `shadow-stage-unknown-price` | 8 | abstain, empty answer | no ticket price is stated |

## Remaining Work

### Annotation Review Findings

A second model-only reading checked all 120 questions against the chapter bodies,
including transfer order, arithmetic, quotations and the 18 unknown questions.
No conflicting canonical answer was identified in that reading. Direct validation
also found no required quote from after its question's inclusive snapshot. This
is not independent human review and does not certify all proofs as necessary or
complete. The frozen JSON and its digest above remain unchanged.

Known annotation risks to resolve before treating evidence scores as calibrated:

| Cases | Finding | Effect |
| --- | --- | --- |
| `reed-canal-usable-ropes`, `reed-canal-final-ropes`, `reed-canal-flood-gap` | Later quotes repeat the initial seven ropes or ninth-grid redline, but the evidence groups also require the earlier quote. | A sufficient shorter proof can fail complete-evidence scoring. |
| `shadow-stage-unsold-at-three`, `shadow-stage-valid-sold`, `shadow-stage-audience-tickets`, `shadow-stage-retrospective-stage` | Later passages repeat the initial inventory, prior sales or old venue. Some earlier required passages are redundant for the question. | Evidence completeness can understate successful retrieval. |
| `reed-canal-ferry-ropes` | The quote says Xu Huai counted ropes "in the warehouse", but the explicit sentence connecting Xu Huai to Liu Warehouse is not in the annotated set. | The proof relies on surrounding chapter context to resolve the warehouse. |
| `orbital-seed-returned-count` | The set omits chapter 3's explicit statement that all intact seeds remained in the box, although the chapter-4 inventory question includes it. | The arithmetic is correct, but the proof depends on an unstated inventory-continuity assumption. |
| `reed-canal-messenger-bell`, `shadow-stage-message-berth`, `orbital-seed-officer-receiver` | Some chain steps restate roles already named in the question or in the final quote. | Annotated passage count does not establish irreducible reasoning depth. |
| `shadow-stage-final-owner` | Its chapter-7 alternative explicitly covers only the time before dispersal; the question asks about the dispersal inventory in chapter 8. | The shorter alternative relies on persistence instead of an explicit observation at the requested time. |

Removing one annotated passage and observing a failed score only checks the
evaluator's enforcement of that annotation. It cannot establish semantic
necessity. Reviewers should add shorter sufficient alternatives, remove redundant
requirements, and add missing bridge or state-continuity evidence in a separately
reviewed dataset revision before making claims about minimal complete proofs.

The three `unknown-future` questions are unknown only at snapshot 2: their answers
are disclosed in later chapters. Runtime isolation must exclude those later
chapters, old query messages and reference annotations. Structural validation
checks required quote cutoffs, not actual runtime context or all possible answer
leakage. The chapter-4 seed trial is an attributed oral report, corrected in
chapter 5; scores at the earlier cutoff describe available records, not later
omniscient truth. Alias and transfer motifs recur across books, and several
multi-hop chains stay within one chapter, limiting claims about genre diversity
or long-distance recall.

### Expansion

This is a 120-case pilot, deliberately below the proposed 180-case target. To
reach 180, add 20 distinct questions per book only after introducing or identifying
new meaningful facts and reasoning paths. Do not fill the gap with renamed copies,
question paraphrases, or many variants of the same transfer. Have independent human
reviewers check every answer, unknown premise, inventory update and complete proof;
record disagreements and update annotation status only after actual review.

The short chapters favor inspectable controlled facts. All three stories share
some diagnostic motifs, so this is not broad genre coverage. The pilot does not
cover real document replacement, restart, archive, worldline restore, long-form
summary grading, claim-level faithfulness, or long-context scaling. The seed-story
record correction is a narrative event, not a database revision test. Additional
evidence paths may need annotation after human review. Freeze a reviewed version
and preserve split boundaries before comparing model or retrieval variants.
