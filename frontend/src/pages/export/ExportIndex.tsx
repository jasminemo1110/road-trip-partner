import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, message, Progress, Spin, Tag } from 'antd';
import { CheckOutlined, DownloadOutlined, EyeOutlined } from '@ant-design/icons';
import { cleanupExportImagesFiles, downloadExportImagesZip, getExportImagesJob, getRoutes, startExportImages, type ExportImagesJob } from '../../api';
import { hasEditAccess } from '../../auth';
import type { Route } from '../../types';

interface ExportOption {
  id: string;
  label: string;
  url: string;
}

interface RouteExportGroup {
  route: Route;
  options: ExportOption[];
}

const overviewOptions: ExportOption[] = [
  {
    id: 'overview-landscape-names',
    label: '横版含城市名',
    url: '/export/render?type=overview&names=true&style=whitesmoke',
  },
  {
    id: 'overview-landscape-clean',
    label: '横版不含城市名',
    url: '/export/render?type=overview&names=false&style=whitesmoke',
  },
  {
    id: 'overview-portrait',
    label: '竖版双地图',
    url: '/export/render?orientation=portrait&type=overview',
  },
  {
    id: 'overview-portrait-single',
    label: '竖版单地图',
    url: '/export/render?orientation=portrait&type=overview&layout=single',
  },
];

function buildRouteGroups(routes: Route[]): RouteExportGroup[] {
  return [...routes].sort((a, b) => a.id - b.id).map(route => ({
    route,
    options: [
      {
        id: `route-${route.id}-landscape-wide`,
        label: '横版全景',
        url: `/export/render?type=route&id=${route.id}&fit=wide&style=whitesmoke`,
      },
      {
        id: `route-${route.id}-landscape-close`,
        label: '横版路线特写',
        url: `/export/render?type=route&id=${route.id}&fit=auto&style=fresh`,
      },
      {
        id: `route-${route.id}-portrait`,
        label: '竖版双地图',
        url: `/export/render?orientation=portrait&type=route&id=${route.id}`,
      },
    ],
  }));
}

function buildCustomOptions(routes: Route[], routeIds: number[]): ExportOption[] {
  if (routeIds.length < 2) return [];
  const ids = routeIds.join('-');
  const idsParam = routeIds.join(',');
  const names = routes
    .filter(route => routeIds.includes(route.id))
    .sort((a, b) => a.id - b.id)
    .map(route => route.name)
    .join(' + ');
  return [
    {
      id: `custom-${ids}-landscape-wide`,
      label: '横版全景纯路线',
      url: `/export/render?type=custom&ids=${idsParam}&fit=wide&names=false&style=whitesmoke`,
    },
    {
      id: `custom-${ids}-landscape-close`,
      label: '横版路线特写城市名',
      url: `/export/render?type=custom&ids=${idsParam}&fit=auto&names=true&style=fresh`,
    },
    {
      id: `custom-${ids}-portrait`,
      label: '竖版双地图',
      url: `/export/render?orientation=portrait&type=custom&ids=${idsParam}`,
    },
  ].map(option => ({ ...option, label: `${option.label} · ${names}` }));
}

export default function ExportIndex() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [customRouteIds, setCustomRouteIds] = useState<number[]>([]);
  const [exportJob, setExportJob] = useState<ExportImagesJob | null>(null);
  const [exporting, setExporting] = useState(false);
  const [savingZip, setSavingZip] = useState(false);
  const [canExport] = useState(() => hasEditAccess());
  const [messageApi, contextHolder] = message.useMessage();

  const routeGroups = useMemo(() => buildRouteGroups(routes), [routes]);
  const customOptions = useMemo(() => buildCustomOptions(routes, customRouteIds), [routes, customRouteIds]);
  const allOptions = useMemo(
    () => [...overviewOptions, ...customOptions, ...routeGroups.flatMap(group => group.options)],
    [customOptions, routeGroups],
  );
  const allIds = useMemo(() => allOptions.map(option => option.id), [allOptions]);
  const portraitIds = useMemo(
    () => allIds.filter(id => id === 'overview-portrait' || id === 'overview-portrait-single' || id.endsWith('-portrait')),
    [allIds],
  );
  const landscapeWideIds = useMemo(
    () => allIds.filter(id => id === 'overview-landscape-names' || id === 'overview-landscape-clean' || id.endsWith('-landscape-wide')),
    [allIds],
  );
  const landscapeCloseIds = useMemo(
    () => allIds.filter(id => id.endsWith('-landscape-close')),
    [allIds],
  );

  useEffect(() => {
    getRoutes().then(rs => {
      setRoutes(rs);
      const groups = buildRouteGroups(rs);
      setSelectedIds(new Set([...overviewOptions, ...groups.flatMap(group => group.options)].map(option => option.id)));
      setLoading(false);
    });
  }, []);

  const includeValue = [...selectedIds].filter(id => allIds.includes(id)).join(',');

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleMany = (ids: string[], checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const toggleCustomRoute = (routeId: number, checked: boolean) => {
    setCustomRouteIds(prev => {
      const next = checked ? [...prev, routeId] : prev.filter(id => id !== routeId);
      return [...new Set(next)].sort((a, b) => a - b);
    });
  };

  const selectOnly = (ids: string[]) => {
    setSelectedIds(new Set(ids));
  };

  const downloadZip = async () => {
    if (!exportJob || exportJob.status !== 'completed') return;
    setSavingZip(true);
    try {
      const filename = `自驾足迹导出-${exportJob.id.slice(0, 8)}.zip`;
      const blob = await downloadExportImagesZip(exportJob.id);
      const picker = (window as Window & {
        showSaveFilePicker?: (options?: unknown) => Promise<{
          createWritable: () => Promise<{
            write: (data: Blob) => Promise<void>;
            close: () => Promise<void>;
          }>;
        }>;
      }).showSaveFilePicker;

      if (picker) {
        const handle = await picker({
          suggestedName: filename,
          types: [{
            description: 'ZIP 压缩包',
            accept: { 'application/zip': ['.zip'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(objectUrl);
      }

      await cleanupExportImagesFiles(exportJob.id);
      setExportJob({ ...exportJob, files_cleaned: true });
      messageApi.success('压缩包已保存，临时文件已清理');
    } catch (error) {
      messageApi.error('保存压缩包失败');
    } finally {
      setSavingZip(false);
    }
  };

  const runExport = async () => {
    if (!canExport) {
      messageApi.warning('一键导出只对编辑链接开放');
      return;
    }
    const include = [...selectedIds].filter(id => allIds.includes(id));
    if (include.length === 0) return;
    setExporting(true);
    try {
      const job = await startExportImages(include, 1500, 2);
      setExportJob(job);
      messageApi.info('已开始导出图片');
      pollExportJob(job.id);
    } catch (error) {
      setExporting(false);
      messageApi.error('启动导出失败');
    }
  };

  const pollExportJob = (jobId: string) => {
    const tick = async () => {
      try {
        const job = await getExportImagesJob(jobId);
        setExportJob(job);
        if (job.status === 'completed') {
          setExporting(false);
          messageApi.success('导出完成');
          return;
        }
        if (job.status === 'failed') {
          setExporting(false);
          messageApi.error('导出失败，请查看下方错误信息');
          return;
        }
        window.setTimeout(tick, 1600);
      } catch {
        setExporting(false);
        messageApi.error('读取导出状态失败');
      }
    };
    window.setTimeout(tick, 1200);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin />
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f6f8f5',
      padding: '32px 20px 48px',
      fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
      color: '#1f2d26',
    }}>
      {contextHolder}
      <main style={{ maxWidth: 1040, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'flex-start', marginBottom: 22 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 28, letterSpacing: 0 }}>导出图片</h2>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Button icon={<CheckOutlined />} onClick={() => toggleMany(allIds, true)}>全选</Button>
            <Button onClick={() => toggleMany(allIds, false)}>清空</Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              disabled={!includeValue || !canExport}
              loading={exporting}
              onClick={runExport}
            >
              一键导出
            </Button>
          </div>
        </header>

        <section style={{
          background: '#fff',
          border: '1px solid #dfe7df',
          borderRadius: 8,
          padding: '14px 16px',
          marginBottom: 18,
        }}>
          <div style={{ fontSize: 14, color: '#52635a', lineHeight: 1.7 }}>
            当前勾选 <b>{selectedIds.size}</b> 张。{canExport ? '点击一键导出后，请保持本页打开；完成后可选择保存压缩包位置。' : '一键导出只对编辑链接开放；只读链接可以继续手动预览。'}
          </div>
          {exportJob && (
            <div style={{
              marginTop: 12,
              borderTop: '1px solid #e6ece4',
              paddingTop: 10,
              color: '#52635a',
              fontSize: 13,
              lineHeight: 1.7,
            }}>
              <div>
                导出状态：<b>{statusLabel(exportJob.status)}</b>
                {exportJob.status === 'running' && <> · 正在导出，请稍等</>}
              </div>
              {typeof exportJob.progress_total === 'number' && exportJob.progress_total > 0 && (
                <div style={{ marginTop: 8 }}>
                  <Progress
                    percent={Math.round(((exportJob.progress_current ?? 0) / exportJob.progress_total) * 100)}
                    size="small"
                    status={exportJob.status === 'failed' ? 'exception' : exportJob.status === 'completed' ? 'success' : 'active'}
                  />
                  <div style={{ color: '#728077', marginTop: 4 }}>
                    {exportJob.progress_current ?? 0}/{exportJob.progress_total} 张
                    {exportJob.current_label && exportJob.status === 'running' && <> · {exportJob.current_label}</>}
                  </div>
                </div>
              )}
              {exportJob.status === 'completed' && (
                <div style={{ marginTop: 10 }}>
                  <Button type="primary" icon={<DownloadOutlined />} loading={savingZip} disabled={exportJob.files_cleaned} onClick={downloadZip}>
                    {exportJob.files_cleaned ? '已保存并清理' : '选择位置保存压缩包'}
                  </Button>
                </div>
              )}
              {exportJob.stderr && exportJob.status === 'failed' && (
                <pre style={{
                  margin: '8px 0 0',
                  padding: 10,
                  borderRadius: 6,
                  background: '#fff1f0',
                  color: '#8c2b25',
                  whiteSpace: 'pre-wrap',
                  maxHeight: 180,
                  overflow: 'auto',
                }}>
                  {exportJob.stderr}
                </pre>
              )}
            </div>
          )}
        </section>

        <ExportSection
          title="全路线"
          options={overviewOptions}
          selectedIds={selectedIds}
          onToggle={toggleOne}
          onToggleAll={toggleMany}
        />

        <section style={{
          background: '#fff',
          border: '1px solid #dfe7df',
          borderRadius: 8,
          padding: '16px',
          marginBottom: 18,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 18, letterSpacing: 0 }}>自定义多线路</h3>
            <Button size="small" onClick={() => setCustomRouteIds([])}>清空组合</Button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: customRouteIds.length >= 2 ? 12 : 0 }}>
            {routes.map(route => (
              <Checkbox
                key={route.id}
                checked={customRouteIds.includes(route.id)}
                onChange={event => toggleCustomRoute(route.id, event.target.checked)}
              >
                <Tag color={route.color} style={{ marginRight: 4 }}>{route.year ?? '线路'}</Tag>
                {route.name}
              </Checkbox>
            ))}
          </div>
          {customRouteIds.length < 2 ? (
            <div style={{ fontSize: 13, color: '#89948c' }}>选择至少 2 条线路后，会生成横版全景纯路线、横版路线特写城市名、竖版双地图三种导出项。</div>
          ) : (
            <ExportSection
              title={`已选 ${customRouteIds.length} 条线路`}
              options={customOptions}
              selectedIds={selectedIds}
              onToggle={toggleOne}
              onToggleAll={toggleMany}
              compact
            />
          )}
        </section>

        <section style={{ marginTop: 18 }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            marginBottom: 10,
            flexWrap: 'wrap',
          }}>
            <h3 style={{ margin: 0, fontSize: 18, letterSpacing: 0 }}>单条线路</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button size="small" onClick={() => selectOnly(portraitIds)}>一键选中全部竖版</Button>
              <Button size="small" onClick={() => selectOnly(landscapeWideIds)}>一键选中横版全景</Button>
              <Button size="small" onClick={() => selectOnly(landscapeCloseIds)}>一键选中横版路线特写</Button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {routeGroups.map(group => (
              <ExportSection
                key={group.route.id}
                title={group.route.name}
                options={group.options}
                selectedIds={selectedIds}
                onToggle={toggleOne}
                onToggleAll={toggleMany}
                compact
              />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function statusLabel(status: ExportImagesJob['status']) {
  switch (status) {
    case 'queued': return '等待中';
    case 'running': return '导出中';
    case 'completed': return '已完成';
    case 'failed': return '失败';
    default: return status;
  }
}

function ExportSection({
  title,
  options,
  selectedIds,
  onToggle,
  onToggleAll,
  compact = false,
}: {
  title: string;
  options: ExportOption[];
  selectedIds: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
  onToggleAll: (ids: string[], checked: boolean) => void;
  compact?: boolean;
}) {
  const ids = options.map(option => option.id);
  const checkedCount = ids.filter(id => selectedIds.has(id)).length;
  const allChecked = checkedCount === ids.length;
  const partiallyChecked = checkedCount > 0 && checkedCount < ids.length;

  return (
    <section style={{
      background: '#fff',
      border: '1px solid #dfe7df',
      borderRadius: 8,
      padding: compact ? '12px 14px' : '16px',
      marginBottom: compact ? 0 : 18,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        marginBottom: 10,
      }}>
        <h3 style={{ margin: 0, fontSize: compact ? 16 : 18, letterSpacing: 0 }}>{title}</h3>
        <Checkbox
          checked={allChecked}
          indeterminate={partiallyChecked}
          onChange={event => onToggleAll(ids, event.target.checked)}
        >
          本组全选
        </Checkbox>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 10,
      }}>
        {options.map(option => (
          <div key={option.id} style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            border: '1px solid #edf1ec',
            borderRadius: 8,
            padding: '10px 12px',
            background: selectedIds.has(option.id) ? '#f4f8f1' : '#fff',
          }}>
            <Checkbox checked={selectedIds.has(option.id)} onChange={event => onToggle(option.id, event.target.checked)}>
              <span style={{ fontSize: 14 }}>{option.label}</span>
            </Checkbox>
            <Button size="small" icon={<EyeOutlined />} onClick={() => window.open(option.url, '_blank')}>
              预览
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
