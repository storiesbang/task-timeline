import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { defaultData, isTimelineData } from '@/lib/timeline';

// 部署時用 DATA_DIR 把資料放在部署目錄外，重新部署不會蓋掉
const dataDirectory = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const dataFile = path.join(dataDirectory, 'timeline.json');

// 公開架站（本機檔案模式）關掉 API，否則所有訪客會共用、互相覆寫同一份伺服器資料
const disabled = process.env.NEXT_PUBLIC_STORAGE === 'file';
const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 });

export async function GET() {
  if (disabled) return notFound();
  try {
    return NextResponse.json(JSON.parse(await readFile(dataFile, 'utf8')));
  } catch (error) {
    // 只有檔案不存在才給預設值；壞檔直接報錯，絕不覆蓋使用者資料
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return NextResponse.json(defaultData);
  }
}

export async function PUT(request: Request) {
  if (disabled) return notFound();
  const data = await request.json().catch(() => null);
  if (!isTimelineData(data)) return NextResponse.json({ error: 'invalid data' }, { status: 400 });
  await mkdir(dataDirectory, { recursive: true });
  // 先寫暫存檔再 rename，寫到一半中斷也不會留下壞檔
  const tmp = `${dataFile}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, dataFile);
  return NextResponse.json({ ok: true });
}
