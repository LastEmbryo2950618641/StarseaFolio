# 同人原作核验反馈

## unavailable

【同人原作核验·第3层兜底】网络与 nikowenku-archive 均未取得可读原作证据。可以依据模型常识和本作品上下文继续创作，但必须在 selfReview 和 assistantMessage 中明确标注“未核验，以下为基于上下文的合理推演”，不得把推演写成已确认的原作事实；用户 AU/改写优先于模型记忆。

## candidate-mismatch

【同人原作核验·候选不匹配】刚才的 nikowenku-archive 候选未通过身份核验，不能下载或引用它。
用户只提作品名时，目标默认是该作品的原作/正史；不能把标题含有该作品名的其他网文或同人小说当作原作。只有用户明确说同人、二创、AU 或指定衍生版本时才按衍生作品查找。
若简介只是 completed/连载中、作者或标签，先用 request_read 的 web 来源读取候选详情页/搜索作品介绍；若介绍和目标原作不符，立即用更完整的作品名、别名、系列名和角色名重新 invoke original_work_search。重搜会废弃旧候选，之后只能下载新搜索返回且简介吻合的 bookId。
获得明确剧情简介且确认同一原作版本后，才 describe 并 invoke original_work_download，传入 bookId 与标题，首次 chapterLimit=1；下载后读回章节，若实际文本仍不符，停止引用并重新搜索。

## web-lookup

【同人原作核验·第1层】当前内容明显涉及原作，但本轮没有可引用的原作证据。
查询目标默认是用户提及作品的原作/正史；只有用户明确指定同人、二创、AU 或其他衍生版本时才切换目标。
先 request_read 按需读取设定集的人设、世界观及参考文件/原作资料/；本作品已有设定和用户改写优先。
本地未覆盖的问题再用 outcome=request_read 查询公开网络：requestedReads.query.sourceKinds 含 web，semanticTexts 写原作名、角色或事件；无关结果时退回短人名/作品名搜索，读取页面正文核实并存为本地参考。不要直接用模型记忆写入原作事实。
搜索摘要和诊断不是已核实证据；页面未能提供可用正文时再进入下一层。

## archive-candidates

【同人原作核验·第2层】已得到 nikowenku-archive 搜索候选。
用户未特别说明时只接受原作/正史候选；标题近似、含有原作名或聚合站镜像都不足以证明身份。
结合候选标题、简介、角色和世界观确认版本；唯一匹配时 action=describe 后 invoke original_work_download，传入 bookId、标题和显式 chapterLimit，首次 1–3 章。存在同名或多版本歧义时先给用户选择，不得把候选摘要当作原作正文证据。

## archive-search

【同人原作核验·第2层】网络没有提供足够可核对证据。
按上下文推断原作名，先 action=describe 再 invoke original_work_search；候选唯一且版本吻合时再 invoke original_work_download，传入 bookId、标题和显式 chapterLimit，首次 1–3 章。下载完成后必须 request_read 读取 参考文件/原作资料/ 下的章节正文，索引和搜索/下载回执本身不算正文证据。
