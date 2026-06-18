import * as fs from 'fs';
import * as path from 'path';
import duckdb from 'duckdb';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
const RAW_DIR = path.join(DATA_DIR, 'alpha_vantage/raw');
const PARQUET_DIR = path.join(DATA_DIR, 'alpha_vantage/parquet');
const MAX_BATCH_GB = parseFloat(process.env.MAX_BATCH_GB || '5');
const DELETE_RAW_CSV = process.env.DELETE_RAW_CSV === 'true';

let db: duckdb.Database | null = null;

function runQuery(query: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('DuckDB not initialized'));
      return;
    }
    db.all(query, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}

async function initDb() {
  if (db) {
    await closeDb();
  }
  db = new duckdb.Database(':memory:');
  // Configure DuckDB to cap memory utilization
  await runQuery(`SET max_memory = '2GB';`);
}

function closeDb(): Promise<void> {
  return new Promise((resolve) => {
    if (db) {
      db.close((err) => {
        if (err) console.error('Error closing DuckDB database:', err);
        db = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

function ensureDirExists(filePath: string) {
  const dirname = path.dirname(filePath);
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
  }
}

async function convertCsvToParquet(csvPath: string, parquetPath: string): Promise<boolean> {
  ensureDirExists(parquetPath);
  try {
    // DuckDB read_csv_auto syntax to copy to Parquet
    const query = `COPY (SELECT * FROM read_csv_auto('${csvPath}')) TO '${parquetPath}' (FORMAT PARQUET);`;
    await runQuery(query);
    return true;
  } catch (err) {
    console.error(`Error converting ${path.basename(csvPath)}:`, err);
    return false;
  }
}

function getFilesRecursively(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const name = path.join(dir, file);
    if (fs.statSync(name).isDirectory()) {
      getFilesRecursively(name, fileList);
    } else {
      if (file.endsWith('.csv') && !file.startsWith('._')) {
        fileList.push(name);
      }
    }
  }
  return fileList;
}

async function main() {
  console.log('🏁 Starting CSV to Parquet conversion process...');
  console.log(`📂 Raw source directory: ${RAW_DIR}`);
  console.log(`📂 Parquet target directory: ${PARQUET_DIR}`);
  console.log(`⚖️ Capped at ${MAX_BATCH_GB} GB of raw CSV data per run.`);

  const csvFiles = getFilesRecursively(RAW_DIR);
  console.log(`📊 Found ${csvFiles.length} total CSV files in raw directory.`);

  if (csvFiles.length === 0) {
    console.log('⚠️ No CSV files found. Make sure data is placed in backend/data/alpha_vantage/raw/');
    return;
  }

  await initDb();

  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;
  let totalSavedBytes = 0;
  let processedCount = 0;
  let convertedBytes = 0;

  const byteLimit = MAX_BATCH_GB * 1024 * 1024 * 1024;
  let limitReached = false;

  for (const csvFile of csvFiles) {
    const relativePath = path.relative(RAW_DIR, csvFile);
    const parquetFile = path.join(PARQUET_DIR, relativePath.replace(/\.csv$/, '.parquet'));

    // Check if parquet file already exists and is non-empty
    if (fs.existsSync(parquetFile) && fs.statSync(parquetFile).size > 0) {
      skippedCount++;
      continue;
    }

    const csvSize = fs.statSync(csvFile).size;

    // Check if processing this file would exceed the batch size limit
    if (convertedBytes + csvSize > byteLimit) {
      limitReached = true;
      break;
    }

    processedCount++;

    // Print progress update
    if (processedCount % 50 === 0 || processedCount === 1) {
      const progressPercent = ((convertedBytes / byteLimit) * 100).toFixed(1);
      console.log(`⏳ Converting file #${processedCount} [Batch Progress: ${progressPercent}%]: ${relativePath} (${(csvSize / 1024).toFixed(1)} KB)`);
    }

    const success = await convertCsvToParquet(csvFile, parquetFile);

    if (success) {
      successCount++;
      convertedBytes += csvSize;
      const parquetSize = fs.statSync(parquetFile).size;
      totalSavedBytes += (csvSize - parquetSize);
      if (DELETE_RAW_CSV) {
        try {
          fs.unlinkSync(csvFile);
        } catch (unlinkErr) {
          console.error(`Failed to delete raw CSV ${relativePath}:`, unlinkErr);
        }
      }
    } else {
      failCount++;
    }

    // Recycle database connection every 500 converted files to free memory
    if (successCount > 0 && successCount % 500 === 0) {
      console.log(`♻️ Recycling DuckDB connection to release system memory...`);
      await initDb();
    }
  }

  await closeDb();

  console.log('\n✅ Conversion process finished!');
  console.log(`⏭️ Already converted & skipped: ${skippedCount} files`);
  console.log(`📈 Successful conversions in this run: ${successCount}`);
  if (failCount > 0) {
    console.log(`❌ Failed conversions: ${failCount}`);
  }
  console.log(`📦 Raw CSV data converted in this run: ${(convertedBytes / (1024 * 1024 * 1024)).toFixed(3)} GB`);
  console.log(`💾 Total disk space saved in this run: ${(totalSavedBytes / (1024 * 1024 * 1024)).toFixed(3)} GB`);

  if (limitReached) {
    console.log(`\n🛑 Capped at ${MAX_BATCH_GB} GB of CSV data processed. Run the script again to process the next batch.`);
  } else {
    console.log(`\n🎉 All CSV files have been successfully converted!`);
  }
}

main().catch(err => {
  console.error('Fatal error in conversion script:', err);
});

