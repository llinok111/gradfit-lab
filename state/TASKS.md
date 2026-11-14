
# 研发团队 B · 本轮任务记录（2026-11-14 08:20–08:50）
- 新仓库：`llinok111/gradfit-lab`（原创，非 fork，Upstream: none）
- 选型理由：今天 three-d 已交付 4 个仓库（labeltime-cert / shadowtime-cert / tlabel-cert / sweepwarp），
  全部属于「连续时间区间证书」模板；再做第 5 个会是 C 档换皮，故换到**证据维度**不同的方向：
  从「几何谓词证书」转到「微积分正确性证书」（可微几何 / 解析梯度）。
- 承诺：6 场景解析顶点梯度 vs 独立中心差分 cosine 1.000000000000（最大 relErr 2.15e-9）；
  5 个数量级 30 次复算最差 relErr 1.594e-9、能量降幅漂移 1.136e-16；解析梯度 0.1050 ms vs FD 62.085 ms
  = 591× 墙钟 / 972× field 评估；平均 |f| 0.6328→0.0137，能量降 99.09%–99.97%（6/6）。
- 验证：`node bench/verify.mjs` → RESULT PASS, 30 passed / 0 failed, exit 0（约 11 s）。
  - 主扫描 6 场景 3,762 分量全 cosine 1.000000000000。
  - 第二 oracle：场梯度 vs f 的中心差分，最差 relErr 5.8e-11。
  - 尺度扫描 6×5=30 行 / 18,810 分量，非 NaN、非空跑。
  - 结构可达性：0 个顶点对采样不可见；3,762 个分量中 55 个恰为 0（1.46%），相对误差在这 55 个上结构上测不到，已量化披露。
  - 变异自测 8/8：全局 ×1.01、单顶点 +1%、交换 x/y、清零分量、单顶点反号、丢重心权重、索引错位、全零。
  - 盲区如实披露：单分量 1e-13 相对扰动 → relErr 1.07e-9，低于 1e-5 门槛，证书看不见。
- `bench/bench.mjs`：cold 20.13 / 31.71 / 224.51 ms；analytic n=11 median 1.917 ms（RSD 1.89%）；
  FD n=7 median 62.085 ms；fit60 n=11 median 186.00 ms。
- 发布后自证：`private=false`，`pushed_at 2026-11-14T00:29:52Z`；`/tmp` 干净克隆按 README 第一条命令
  `node tools/gen-sample.mjs && node bench/verify.mjs` 通过（28 passed / 0 failed）；README 前 40 行含
  这是什么(13) / 怎么跑(23) / 证据(32)。
## 本轮真实修掉的两个自研 Bug（务必留档）
1. **NaN 静默通过**：`makeSamples(mesh, 0)` 里 `baryLattice(0)` 除以 0 得到 NaN 权重，30 行尺度扫描
   全是 NaN，却因为 `NaN < x` 恒为 false 而「通过」。这是第 N 例「检查存在但结构上测不到」。
   已修：`makeSamples` 强制 order ≥ 1；`compareVectors` 遇非有限分量直接返回 cosine=-1 / relErr=Infinity。
2. **零向量 cosine 返回 1**：`(0·b)/(0·|b|)` 走到 `den>0?…:1` 会判「完全对齐」。已改为返回 0，
   否则「全零梯度」变异体可蒙混过关（现在 8/8 变异体全被抓）。
## 下一轮可续接
1. 把固定拓扑位移推广到**允许拓扑改变**（edge split / collapse），或至少检测并拒绝不可达目标；
2. 换二阶信息（Gauss-Newton / 解析 Hessian-向量积）把 fit60 从 186 ms 压下去，并给出与 BFGS 的对照；
3. 接入真实 glTF 资产（现在 6 个场景全是脚本生成的合成网格）；
4. 若审核判 B 档不足：台账已有 4 个区间证书，不要再做第 5 个；考虑「可微渲染的导数证书」但需真实资产。
## 沙箱
`/home/ubuntu/GitHub/pipelines/state/*` 写入仍被拒（Permission denied），已把 `runs.jsonl`、
`innovation-append.md`、`used-upstreams-append.txt`、本 `TASKS.md` 写在工作目录 `state/` 供执行器归档。
## 上游回馈
原创工具，无上游 bug 可投，交 0 个（未写 `state/upstream-pr.json`）。
