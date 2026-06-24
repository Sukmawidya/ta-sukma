require('dotenv').config();
const express = require('express');
const mqtt = require('mqtt');
const { InfluxDB } = require('@influxdata/influxdb-client');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Inisialisasi InfluxDB Client (HANYA UNTUK QUERY / MEMBACA DATA)
const influxDB = new InfluxDB({ url: process.env.INFLUX_URL, token: process.env.INFLUX_TOKEN });
const queryApi = influxDB.getQueryApi(process.env.INFLUX_ORG);
const BUCKET = process.env.INFLUX_BUCKET || "sensoraht20"; // Default fallback sesuai kodemu

// Koneksi MQTT Broker (Hanya untuk mengirim perintah aktuator dari Control Panel)
const mqttClient = mqtt.connect(process.env.MQTT_BROKER);

mqttClient.on('connect', () => {
    console.log('✓ Terhubung ke MQTT Broker');
    // Subscribe dihapus karena data realtime sekarang tembak langsung ke database
});

// ========================================================
// 1. Endpoint: Mengambil Data Realtime Terakhir (Dari InfluxDB)
// ========================================================
app.get('/api/realtime', async (req, res) => {
    // Gunakan fungsi pivot dan limit(n: 1) untuk mengambil 1 baris terakhir
    const fluxQuery = `
        from(bucket: "${BUCKET}")
            |> range(start: -1h)
            |> filter(fn: (r) => r["_measurement"] == "sensoraht20")
            |> filter(fn: (r) => r["_field"] == "kelembapan" or r["_field"] == "suhu" or r["_field"] == "fanStatus" or r["_field"] == "mistStatus")
            |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
            |> sort(columns: ["_time"], desc: true)
            |> limit(n: 1)
    `;

    // Nilai default jika database kosong atau sensor mati > 1 jam
    let latestData = {
        temperature: 0,
        humidity: 0,
        fanStatus: false,
        mistStatus: false,
        time: '--:--:--'
    };

    try {
        await new Promise((resolve, reject) => {
            queryApi.queryRows(fluxQuery, {
                next(row, tableMeta) {
                    const o = tableMeta.toObject(row);
                    
                    const parseStatus = (val) => {
                        if (val === 'ON' || val === 'on' || val === 1 || val === true) return true;
                        return false;
                    };

                    latestData = {
                        temperature: Number(o.suhu ?? 0),
                        humidity: Number(o.kelembapan ?? 0),
                        fanStatus: parseStatus(o.fanStatus),
                        mistStatus: parseStatus(o.mistStatus),
                        time: new Date(o._time).toLocaleTimeString('id-ID', { hour12: false })
                    };
                },
                error(err) {
                    reject(err);
                },
                complete() {
                    resolve();
                }
            });
        });

        // KUNCI SOLUSI 304: Matikan cache untuk endpoint realtime
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.json(latestData);

    } catch (err) {
        console.error('Gagal query realtime InfluxDB:', err);
        res.status(500).json({ error: 'Gagal mengambil data realtime' });
    }
});

// ========================================================
// 2. Endpoint: Mengirim Perintah Pengendalian
// ========================================================
app.post('/api/control', (req, res) => {
    const { device, state } = req.body;
    const payload = `${device.toUpperCase()}_${state.toUpperCase()}`; 
    mqttClient.publish(process.env.MQTT_TOPIC_CONTROL, payload);
    res.json({ success: true, message: `Command ${payload} terkirim ke MQTT.` });
});

// ========================================================
// 3. Endpoint: Query Data Historis (Tabel)
// ========================================================
app.get('/api/history', async (req, res) => {
    const { range, start, end } = req.query;
    let rangeQuery = '';

    if (range === 'custom' && start && end) {
        rangeQuery = `|> range(start: ${new Date(start).toISOString()}, stop: ${new Date(end).toISOString()})`;
    } else {
        const validRanges = ['1h', '12h', '24h', '7d', '30d'];
        const selectedRange = validRanges.includes(range) ? range : '24h';
        rangeQuery = `|> range(start: -${selectedRange})`;
    }

    const fluxQuery = `
        from(bucket: "${BUCKET}")
            ${rangeQuery}
            |> filter(fn: (r) => r["_measurement"] == "sensoraht20")
            |> filter(fn: (r) => r["_field"] == "kelembapan" or r["_field"] == "suhu" or r["_field"] == "fanStatus" or r["_field"] == "mistStatus")
            |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
            |> sort(columns: ["_time"], desc: true)
            |> limit(n: 5000)
    `;

    const logs = [];
    try {
        await new Promise((resolve, reject) => {
            queryApi.queryRows(fluxQuery, {
                next(row, tableMeta) {
                    const o = tableMeta.toObject(row);
                    logs.push({
                        time: new Date(o._time).toLocaleString('id-ID'),
                        temp: o.suhu ?? 0,
                        hum: o.kelembapan ?? 0,
                        fStatus: o.fanStatus ?? false,
                        mStatus: o.mistStatus ?? false
                    });
                },
                error(error) { reject(error); },
                complete() { resolve(); }
            });
        });
        res.json(logs);
    } catch (err) {
        console.error('InfluxDB Query Error (History):', err);
        res.status(500).json({ error: err.message });
    }
});

// ========================================================
// 4. Endpoint: Query Khusus Grafik Dinamis
// ========================================================
app.get('/api/chart-data', async (req, res) => {
    const { range, start, end } = req.query;
    let rangeQuery = '';

    if (range === 'custom' && start && end) {
        rangeQuery = `|> range(start: ${new Date(start).toISOString()}, stop: ${new Date(end).toISOString()})`;
    } else {
        const validRanges = ['1h', '12h', '24h', '7d', '30d'];
        const selectedRange = validRanges.includes(range) ? range : '24h';
        rangeQuery = `|> range(start: -${selectedRange})`;
    }

    const fluxQuery = `
        from(bucket: "${BUCKET}")
            ${rangeQuery}
            |> filter(fn: (r) => r["_measurement"] == "sensoraht20")
            |> filter(fn: (r) => r["_field"] == "kelembapan" or r["_field"] == "suhu")
            |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
            |> sort(columns: ["_time"], desc: false)
    `;

    const chartData = { labels: [], temps: [], hums: [] };
    try {
        await new Promise((resolve, reject) => {
            queryApi.queryRows(fluxQuery, {
                next(row, tableMeta) {
                    const o = tableMeta.toObject(row);
                    const d = new Date(o._time);
                    
                    const hours = String(d.getHours()).padStart(2,'0');
                    const mins = String(d.getMinutes()).padStart(2,'0');
                    const secs = String(d.getSeconds()).padStart(2,'0');
                    
                    const timeLabel = (range === '7d' || range === '30d' || range === 'custom') 
                        ? `${d.getDate()}/${d.getMonth()+1} ${hours}:${mins}:${secs}`
                        : `${hours}:${mins}:${secs}`;
                    
                    chartData.labels.push(timeLabel);
                    chartData.temps.push(o.suhu ?? null);
                    chartData.hums.push(o.kelembapan ?? null);
                },
                error(error) { reject(error); },
                complete() { resolve(); }
            });
        });
        res.json(chartData);
    } catch (err) {
        console.error('InfluxDB Query Error (Chart):', err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server monolit IoT berjalan di http://localhost:${PORT}`);
});