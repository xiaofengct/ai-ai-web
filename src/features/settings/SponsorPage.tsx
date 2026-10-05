import { useCallback, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LaunchIcon from '@mui/icons-material/Launch';
import { sl } from './settingsCopy';
import { copyText } from '@/lib/download';
import { useSnack } from '@/hooks/useSnack';

/**
 * 打赏 / 鸣谢页（PG-21）。
 *
 * ★ 能力表 PG-21 = `partial`：**没有支付 SDK**，只能做静态展示
 *   （二维码图片 + 链接 + 致谢文案），点击复制或跳转。
 *
 * ★ 决策 A6：不做未知第三方跳转，链接位默认留空，由用户自己填。
 *   二维码图片放 `public/sponsor-qr.png`，缺图时如实提示（不编造、不占位糊弄）。
 */

/** 收款码图片路径（放在 public/ 下，缺失时页面会给提示） */
const QR_SRC = '/sponsor-qr.png';

export function SponsorPage(): JSX.Element {
  const snack = useSnack();
  /** 收款码图加载失败时才提示「还没放图」；图在就不多说（scripts/gen-assets.mjs 会生成占位图） */
  const [imgError, setImgError] = useState<boolean>(false);

  /** 打赏链接：留空壳，用户可自行替换（A6：不内置未知外链） */
  const sponsorLink = '';

  const handleCopy = useCallback(async (): Promise<void> => {
    const done = await copyText(sponsorLink);
    // ★ 复制成功/失败分开走（原 snack.raw() 恒译「好了」，B-03）
    if (done) snack.success('common.copied');
    else snack.error('err.unknown');
  }, [snack]);

  return (
    <Box sx={{ width: '100%', maxWidth: 720, mx: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      <Stack spacing={0.25} sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {sl('label.sponsor')}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.7 }}>
          {sl('page.sponsor.desc')}
        </Typography>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="body1" sx={{ fontWeight: 600 }}>
          {sl('sponsor.thanks')}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.75, mt: 0.75 }}>
          {sl('sponsor.note')}
        </Typography>

        <Divider sx={{ my: 2 }} />

        {/* —— 收款码（静态图片） —— */}
        <Typography variant="caption" sx={{ opacity: 0.6 }}>
          {sl('sponsor.qr')}
        </Typography>
        <Box
          sx={{
            mt: 0.75,
            width: 220,
            height: 220,
            border: '1px dashed',
            borderColor: 'divider',
            borderRadius: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {imgError ? (
            <Typography variant="caption" sx={{ opacity: 0.6, px: 2, textAlign: 'center' }}>
              {sl('sponsor.qrMissing')}
            </Typography>
          ) : (
            <Box
              component="img"
              src={QR_SRC}
              alt={sl('sponsor.qr')}
              onError={() => setImgError(true)}
              sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          )}
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* —— 链接（留空壳） —— */}
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Chip size="small" variant="outlined" label={sponsorLink === '' ? sl('ui.notSet') : sponsorLink} />
          <Button
            size="small"
            variant="outlined"
            startIcon={<ContentCopyIcon />}
            onClick={() => void handleCopy()}
            disabled={sponsorLink === ''}
            sx={{ minHeight: 44 }}
          >
            {sl('sponsor.copyLink')}
          </Button>
          {sponsorLink !== '' ? (
            <Button
              size="small"
              variant="text"
              endIcon={<LaunchIcon fontSize="small" />}
              href={sponsorLink}
              target="_blank"
              rel="noreferrer"
              sx={{ minHeight: 44 }}
            >
              {sl('sponsor.openLink')}
            </Button>
          ) : null}
        </Stack>
      </Paper>
    </Box>
  );
}

export default SponsorPage;
