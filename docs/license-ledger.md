# 发行台账 · bz Review 激活码号段

> 这里只记**号段**，不放码。码在 `scripts/keys/issued/`（整目录 gitignore，不进仓库）。
> 台账机器版：`scripts/keys/issued/ledger.json`。
> 前缀 `BZP2` 只对 bz Review 有效；bz Reader 的赞助人 / 专属定制码（`BZR2` 且带 `patron`）两款插件都能激活，普通 `BZR2` 不通用。

| 批次 | 号段 | 数量 | 日期 | 状态 | 码文件 |
|---|---|---:|---|---|---|
| 1 | `REV-2026-0001` – `REV-2026-0100` | 100 | 2026-11-21 | 已签发（待交付爱发电） | `rev-batch-01.txt` |

**下一个可用序号：`0101`**

## 规矩

- 序号只增不减，**不复用**——发过、删掉、标 revoked 的号都不再分配。
- 新批次从台账 `nextSeq` 起连续签，签完自查：id 不重复、码不重复、序号不空号。
- 发现某枚码被公开传播：爱发电那边删掉对应行止血，台账里把这枚标 `revoked`，号**不回收**。
- 插件是离线验签，没有远程吊销。台账是「发过什么」的唯一事实来源，别只靠记忆。

## 签发命令

```powershell
# 普通批次码：不署名，高级版（不限数量）
node scripts/issue-license.mjs --plan lifetime --id REV-2026-0001

# 定制昵称码：加群报名字后逐枚签，关于条直接显示昵称
node scripts/issue-license.mjs --plan lifetime --name 小明 --id REV-2026-0101
```

`--plan lifetime` + 不传 `--days/--until` = 永久（payload 无 `exp`）。
定制码占同一号段，签完同样要更新 `ledger.json` 与上表。
