using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace Glint {

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCo { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
  [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
  [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
  [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
}
[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection {
  [PreserveSig] int GetCount(out uint count);
  [PreserveSig] int Item(uint index, out IMMDevice device);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore props);
  [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  [PreserveSig] int GetState(out int state);
}
[StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Explicit, Size = 24)] struct PROPVARIANT { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; }
[ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore {
  [PreserveSig] int GetCount(out int count);
  [PreserveSig] int GetAt(int i, out PROPERTYKEY key);
  [PreserveSig] int GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
  [PreserveSig] int SetValue(ref PROPERTYKEY key, ref PROPVARIANT value);
  [PreserveSig] int Commit();
}
[ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioClient {
  [PreserveSig] int Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
  [PreserveSig] int GetBufferSize(out uint frames);
  [PreserveSig] int GetStreamLatency(out long latency);
  [PreserveSig] int GetCurrentPadding(out uint padding);
  [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
  [PreserveSig] int GetMixFormat(out IntPtr format);
  [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minPeriod);
  [PreserveSig] int Start();
  [PreserveSig] int Stop();
  [PreserveSig] int Reset();
  [PreserveSig] int SetEventHandle(IntPtr handle);
  [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
}
[ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioCaptureClient {
  [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
  [PreserveSig] int ReleaseBuffer(uint frames);
  [PreserveSig] int GetNextPacketSize(out uint frames);
}

[StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
struct DXGI_OUTPUT_DESC {
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
  public RECT Desktop; public int Attached; public int Rotation; public IntPtr Monitor;
}
[ComImport, Guid("7b7166ec-21c7-44ae-b21a-c9ae321ae369"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDXGIFactory {
  [PreserveSig] int SetPrivateData(); [PreserveSig] int SetPrivateDataInterface(); [PreserveSig] int GetPrivateData(); [PreserveSig] int GetParent();
  [PreserveSig] int EnumAdapters(uint index, out IDXGIAdapter adapter);
}
[ComImport, Guid("2411e7e1-12ac-4ccf-bd14-9798e8534dc0"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDXGIAdapter {
  [PreserveSig] int SetPrivateData(); [PreserveSig] int SetPrivateDataInterface(); [PreserveSig] int GetPrivateData(); [PreserveSig] int GetParent();
  [PreserveSig] int EnumOutputs(uint index, out IDXGIOutput output);
  [PreserveSig] int GetDesc(out DXGI_ADAPTER_DESC desc);
  [PreserveSig] int CheckInterfaceSupport(ref Guid iid, out long umdVersion);
}
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
struct DXGI_ADAPTER_DESC {
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
  public uint VendorId, DeviceId, SubSysId, Revision;
  public UIntPtr DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory;
  public uint LuidLow; public int LuidHigh;
}
[ComImport, Guid("ae02eedb-c735-4690-8d52-5a8dc20213aa"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDXGIOutput {
  [PreserveSig] int SetPrivateData(); [PreserveSig] int SetPrivateDataInterface(); [PreserveSig] int GetPrivateData(); [PreserveSig] int GetParent();
  [PreserveSig] int GetDesc(out DXGI_OUTPUT_DESC desc);
}

static class Native {
  [DllImport("winmm.dll")] public static extern int timeBeginPeriod(int ms);
  [DllImport("ole32.dll")] public static extern void CoTaskMemFree(IntPtr p);
  [DllImport("ole32.dll")] public static extern int PropVariantClear(ref PROPVARIANT pv);
  [DllImport("dxgi.dll")] public static extern int CreateDXGIFactory1(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object factory);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int idx);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct PT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref PT p);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr mon, ref MONITORINFO mi);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(POINT pt, uint flags);
  [DllImport("kernel32.dll")] public static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool Process32FirstW(IntPtr snap, ref PROCESSENTRY32W e);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool Process32NextW(IntPtr snap, ref PROCESSENTRY32W e);
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageNameW(IntPtr h, uint flags, StringBuilder name, ref uint size);
  [DllImport("kernel32.dll")] public static extern bool GetProcessTimes(IntPtr h, out long creation, out long exit, out long kernel, out long user);
  [DllImport("ntdll.dll")] public static extern int NtQueryInformationProcess(IntPtr h, int cls, IntPtr buf, int len, out int ret);
}
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
struct PROCESSENTRY32W {
  public uint dwSize, cntUsage, th32ProcessID; public IntPtr th32DefaultHeapID; public uint th32ModuleID, cntThreads, th32ParentProcessID; public int pcPriClassBase; public uint dwFlags;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
}

static class Json {
  public static string S(string s) {
    if (s == null) return "null";
    var sb = new StringBuilder("\"");
    foreach (char c in s) {
      if (c == '"') sb.Append("\\\""); else if (c == '\\') sb.Append("\\\\");
      else if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
      else sb.Append(c);
    }
    return sb.Append('"').ToString();
  }
}

[ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IActivateAudioInterfaceAsyncOperation { [PreserveSig] int GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activated); }
[ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IActivateAudioInterfaceCompletionHandler { [PreserveSig] int ActivateCompleted(IActivateAudioInterfaceAsyncOperation op); }
[ComImport, Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAgileObject { }
[ClassInterface(ClassInterfaceType.None), ComVisible(true)]
class ActivationHandler : IActivateAudioInterfaceCompletionHandler, IAgileObject {
  public readonly ManualResetEvent Done = new ManualResetEvent(false);
  public int Hr = -1; public object Iface;
  public int ActivateCompleted(IActivateAudioInterfaceAsyncOperation op) {
    try { int hr; object o; int r = op.GetActivateResult(out hr, out o); Hr = r != 0 ? r : hr; Iface = o; } catch (Exception e) { Hr = Marshal.GetHRForException(e); }
    Done.Set();
    return 0;
  }
}
static class ProcLoop {
  [DllImport("Mmdevapi.dll", ExactSpelling = true)]
  static extern int ActivateAudioInterfaceAsync([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid riid, IntPtr activationParams, IActivateAudioInterfaceCompletionHandler handler, out IActivateAudioInterfaceAsyncOperation op);
  public static IAudioClient Activate(uint pid, out int hrOut) {
    hrOut = -1;
    IntPtr prm = Marshal.AllocHGlobal(12), pv = Marshal.AllocHGlobal(24);
    try {
      Marshal.WriteInt32(prm, 0, 1);
      Marshal.WriteInt32(prm, 4, (int)pid);
      Marshal.WriteInt32(prm, 8, 0);
      for (int i = 0; i < 24; i += 4) Marshal.WriteInt32(pv, i, 0);
      Marshal.WriteInt16(pv, 0, 65);
      Marshal.WriteInt32(pv, 8, 12);
      Marshal.WriteIntPtr(pv, 16, prm);
      var h = new ActivationHandler();
      Guid iid = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
      IActivateAudioInterfaceAsyncOperation op;
      int hr = ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref iid, pv, h, out op);
      if (hr != 0) { hrOut = hr; return null; }
      if (!h.Done.WaitOne(5000)) { hrOut = -2; return null; }
      hrOut = h.Hr;
      return h.Hr == 0 ? h.Iface as IAudioClient : null;
    } catch (Exception e) { hrOut = Marshal.GetHRForException(e); return null; }
    finally { Marshal.FreeHGlobal(prm); Marshal.FreeHGlobal(pv); }
  }
}

class Source {
  const int SHARED = 0;
  const uint LOOPBACK = 0x00020000, EVENTCB = 0x00040000, AUTOCONVERT = 0x80000000, SRC_QUALITY = 0x08000000;
  static Guid IID_IAudioClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
  static Guid IID_IAudioCaptureClient = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");
  public string Kind;
  public string Mode = "none";
  public bool Loopback;
  public string WantId;
  public uint Pid;
  public string[] AppNames;
  public bool FallbackSystem;
  public string DeviceId, Name;
  IAudioClient client; IAudioCaptureClient capture; IntPtr procHandle = IntPtr.Zero;
  ManualResetEvent evt;
  bool pcm16;
  public float Gain = 1f;
  public float[] Q = new float[48000 * 2 * 4]; public int QLen = 0;
  public bool Alive { get { return client != null; } }

  static IntPtr Format(bool pcm) {
    IntPtr p = Marshal.AllocHGlobal(40);
    byte[] b = new byte[40];
    int bits = pcm ? 16 : 32, align = 2 * bits / 8;
    BitConverter.GetBytes((ushort)0xFFFE).CopyTo(b, 0);
    BitConverter.GetBytes((ushort)2).CopyTo(b, 2);
    BitConverter.GetBytes(48000u).CopyTo(b, 4);
    BitConverter.GetBytes((uint)(48000 * align)).CopyTo(b, 8);
    BitConverter.GetBytes((ushort)align).CopyTo(b, 12);
    BitConverter.GetBytes((ushort)bits).CopyTo(b, 14);
    BitConverter.GetBytes((ushort)22).CopyTo(b, 16);
    BitConverter.GetBytes((ushort)bits).CopyTo(b, 18);
    BitConverter.GetBytes(3u).CopyTo(b, 20);
    new Guid(pcm ? "00000001-0000-0010-8000-00aa00389b71" : "00000003-0000-0010-8000-00aa00389b71").ToByteArray().CopyTo(b, 24);
    Marshal.Copy(b, 0, p, 40);
    return p;
  }
  public static string FriendlyName(IMMDevice d) {
    IPropertyStore ps;
    if (d.OpenPropertyStore(0, out ps) != 0 || ps == null) return "";
    var key = new PROPERTYKEY { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
    PROPVARIANT v;
    if (ps.GetValue(ref key, out v) != 0) return "";
    string s = v.vt == 31 ? Marshal.PtrToStringUni(v.p) : "";
    Native.PropVariantClear(ref v);
    return s ?? "";
  }
  public static string DefaultId(IMMDeviceEnumerator en, bool render) {
    IMMDevice d; string id = null;
    if (en.GetDefaultAudioEndpoint(render ? 0 : 1, 0, out d) == 0 && d != null) d.GetId(out id);
    return id;
  }
  bool Finish(IAudioClient c, bool process) {
    object s; Guid ciid = IID_IAudioCaptureClient;
    if (process) { evt = new ManualResetEvent(false); if (c.SetEventHandle(evt.SafeWaitHandle.DangerousGetHandle()) != 0) return false; }
    if (c.GetService(ref ciid, out s) != 0) return false;
    if (c.Start() != 0) return false;
    client = c; capture = (IAudioCaptureClient)s; QLen = 0;
    return true;
  }
  public bool OpenDevice(IMMDeviceEnumerator en, bool loopback, string id) {
    Close();
    try {
      IMMDevice dev;
      int hr = id == null ? en.GetDefaultAudioEndpoint(loopback ? 0 : 1, 0, out dev) : en.GetDevice(id, out dev);
      if (hr != 0 || dev == null) return false;
      dev.GetId(out DeviceId); Name = FriendlyName(dev);
      object o; Guid iid = IID_IAudioClient;
      if (dev.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) return false;
      var c = (IAudioClient)o;
      IntPtr fmt = Format(false);
      hr = c.Initialize(SHARED, (loopback ? LOOPBACK : 0) | AUTOCONVERT | SRC_QUALITY, 2000000, 0, fmt, IntPtr.Zero);
      Marshal.FreeHGlobal(fmt);
      if (hr != 0) { Program.Status("{\"warn\":\"init\",\"kind\":" + Json.S(Kind) + ",\"hr\":" + hr + "}"); return false; }
      pcm16 = false;
      return Finish(c, false);
    } catch (Exception e) { Program.Status("{\"warn\":" + Json.S(e.Message) + "}"); Close(); return false; }
  }
  public bool OpenProcess(uint pid) {
    Close();
    int hr;
    var c = ProcLoop.Activate(pid, out hr);
    if (c == null) { Program.Status("{\"warn\":\"process_loopback\",\"kind\":" + Json.S(Kind) + ",\"hr\":" + hr + "}"); return false; }
    foreach (bool pcm in new[] { false, true }) {
      IntPtr fmt = Format(pcm);
      hr = c.Initialize(SHARED, LOOPBACK | EVENTCB | AUTOCONVERT | SRC_QUALITY, 2000000, 0, fmt, IntPtr.Zero);
      Marshal.FreeHGlobal(fmt);
      if (hr == 0) { pcm16 = pcm; break; }
      if (!pcm) {
        try { Marshal.ReleaseComObject(c); } catch { }
        c = ProcLoop.Activate(pid, out hr);
        if (c == null) return false;
      }
    }
    if (hr != 0) { Program.Status("{\"warn\":\"process_init\",\"kind\":" + Json.S(Kind) + ",\"hr\":" + hr + "}"); return false; }
    if (!Finish(c, true)) return false;
    Pid = pid;
    procHandle = Native.OpenProcess(0x00100000, false, pid);
    return true;
  }
  public bool ProcessExited() { return procHandle != IntPtr.Zero && Native.WaitForSingleObject(procHandle, 0) == 0; }
  public void Close() {
    try { if (client != null) client.Stop(); } catch { }
    if (capture != null) { try { Marshal.ReleaseComObject(capture); } catch { } }
    if (client != null) { try { Marshal.ReleaseComObject(client); } catch { } }
    if (procHandle != IntPtr.Zero) { Native.CloseHandle(procHandle); procHandle = IntPtr.Zero; }
    capture = null; client = null; QLen = 0;
  }
  short[] tmp16 = new short[48000 * 2];
  void Push(IntPtr data, int frames, bool silent) {
    int n = frames * 2;
    if (QLen + n > Q.Length) {
      int drop = QLen + n - Q.Length; if (drop > QLen) drop = QLen;
      Array.Copy(Q, drop, Q, 0, QLen - drop); QLen -= drop;
      if (n > Q.Length) n = Q.Length;
    }
    if (silent || data == IntPtr.Zero) Array.Clear(Q, QLen, n);
    else if (pcm16) {
      if (tmp16.Length < n) tmp16 = new short[n];
      Marshal.Copy(data, tmp16, 0, n);
      for (int i = 0; i < n; i++) Q[QLen + i] = tmp16[i] / 32768f;
    } else Marshal.Copy(data, Q, QLen, n);
    QLen += n;
  }
  public bool Pump() {
    if (capture == null) return false;
    for (int guard = 0; guard < 64; guard++) {
      uint next;
      int hr = capture.GetNextPacketSize(out next);
      if (hr != 0) { Close(); return false; }
      if (next == 0) return true;
      IntPtr data; uint frames, flags; ulong dp, qp;
      hr = capture.GetBuffer(out data, out frames, out flags, out dp, out qp);
      if (hr != 0) { Close(); return false; }
      Push(data, (int)frames, (flags & 2) != 0);
      capture.ReleaseBuffer(frames);
    }
    return true;
  }
  public void Take(float[] mix, int frames) {
    int n = frames * 2, have = Math.Min(n, QLen);
    for (int i = 0; i < have; i++) { float v = Q[i] * Gain; mix[i] = v > 1f ? 1f : v < -1f ? -1f : v; }
    for (int i = have; i < n; i++) mix[i] = 0f;
    Array.Copy(Q, have, Q, 0, QLen - have); QLen -= have;
    if (QLen > 48000 * 2 * 15 / 100) { int keep = 48000 * 2 * 4 / 100; Array.Copy(Q, QLen - keep, Q, 0, keep); QLen = keep; }
  }
}

static class Program {
  static readonly object outLock = new object();
  public static void Status(string json) { lock (outLock) { try { Console.Error.WriteLine(json); Console.Error.Flush(); } catch { } } }
  static long NowMs() { return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds; }

  [MTAThread]
  static int Main(string[] args) {
    var utf8 = new UTF8Encoding(false);
    Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), utf8) { AutoFlush = true });
    Console.SetError(new StreamWriter(Console.OpenStandardError(), utf8) { AutoFlush = true });
    string mode = args.Length > 0 ? args[0] : "";
    try {
      if (mode == "audio") return Audio(args);
      if (mode == "devices") return Devices();
      if (mode == "procs") return Procs();
      if (mode == "monitor") return Monitor(args.Length > 1 ? args[1] : "");
      if (mode == "fg") return Foreground();
      if (mode == "gpu") return Gpu();
    } catch (Exception e) { Status("{\"error\":" + Json.S(e.ToString()) + "}"); return 2; }
    Console.Error.WriteLine("usage: glint-helper audio|devices|procs|monitor");
    return 1;
  }

  static uint FindApp(string[] names) {
    IntPtr snap = Native.CreateToolhelp32Snapshot(2, 0);
    var e = new PROCESSENTRY32W(); e.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32W));
    var pids = new Dictionary<uint, uint>(); var children = new Dictionary<uint, int>();
    var set = new HashSet<string>(names, StringComparer.OrdinalIgnoreCase);
    if (Native.Process32FirstW(snap, ref e)) {
      do { if (set.Contains(e.szExeFile)) pids[e.th32ProcessID] = e.th32ParentProcessID; } while (Native.Process32NextW(snap, ref e));
    }
    Native.CloseHandle(snap);
    uint best = 0; int bestKids = -1;
    foreach (var kv in pids) {
      if (pids.ContainsKey(kv.Value)) continue;
      int kids = 0; foreach (var o in pids) if (o.Value == kv.Key) kids++;
      if (kids > bestKids) { best = kv.Key; bestKids = kids; }
    }
    return best;
  }
  static float F(string s) { float v; return float.TryParse(s, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out v) ? v : 1f; }

  // audio --track game:proc=1234[:fallback] --track mic:dev=default --track discord:app=discord.exe,discordcanary.exe
  //       --track desktop:sys   [each may end with @<gain>]
  // -> stdout: float32 48k, 2 channels PER TRACK interleaved (track 0 = channels 0-1, track 1 = 2-3, ...)
  static int Audio(string[] args) {
    Native.timeBeginPeriod(1);
    var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCo();
    var tracks = new List<Source>();
    for (int i = 1; i < args.Length; i++) {
      if (args[i] != "--track" || i + 1 >= args.Length) continue;
      string spec = args[++i];
      float gain = 1f;
      int at = spec.LastIndexOf('@'); if (at > 0) { gain = F(spec.Substring(at + 1)); spec = spec.Substring(0, at); }
      int c = spec.IndexOf(':'); if (c <= 0) continue;
      var s = new Source { Kind = spec.Substring(0, c), Gain = gain };
      string rest = spec.Substring(c + 1);
      if (rest.StartsWith("proc=")) { var p = rest.Substring(5).Split(':'); uint pid; uint.TryParse(p[0], out pid); s.Pid = pid; s.FallbackSystem = p.Length > 1 && p[1] == "fallback"; s.Mode = "process"; }
      else if (rest.StartsWith("dev=")) { string d = rest.Substring(4); s.WantId = d == "default" ? null : d; s.Loopback = false; s.Mode = "device"; }
      else if (rest.StartsWith("app=")) { s.AppNames = rest.Substring(4).Split(','); s.Mode = "app"; }
      else if (rest == "sys") { s.Loopback = true; s.Mode = "system"; }
      tracks.Add(s);
    }
    if (tracks.Count == 0) tracks.Add(new Source { Kind = "desktop", Mode = "silent" });
    var state = new string[tracks.Count];
    for (int k = 0; k < tracks.Count; k++) {
      var s = tracks[k];
      if (s.Mode == "process") {
        if (s.Pid != 0 && s.OpenProcess(s.Pid)) state[k] = "process";
        else if (s.FallbackSystem && s.OpenDevice(en, true, null)) { state[k] = "system"; s.Mode = "system"; s.Loopback = true; }
        else state[k] = "none";
      } else if (s.Mode == "device") state[k] = s.OpenDevice(en, false, s.WantId) ? "device" : "none";
      else if (s.Mode == "system") state[k] = s.OpenDevice(en, true, null) ? "system" : "none";
      else if (s.Mode == "app") { uint pid = FindApp(s.AppNames); state[k] = pid != 0 && s.OpenProcess(pid) ? "app" : "waiting"; }
      else state[k] = "none";
    }
    var input = new Thread(() => {
      try { while (Console.In.ReadLine() != null) { } } catch { }
      Environment.Exit(0);
    });
    input.IsBackground = true; input.Start();

    long t0 = NowMs();
    var sw = Stopwatch.StartNew();
    var sb = new StringBuilder("{\"ok\":true,\"rate\":48000,\"t0\":" + t0 + ",\"tracks\":[");
    for (int k = 0; k < tracks.Count; k++) {
      if (k > 0) sb.Append(',');
      sb.Append("{\"kind\":" + Json.S(tracks[k].Kind) + ",\"state\":" + Json.S(state[k]) + ",\"name\":" + Json.S(tracks[k].Name) + ",\"pid\":" + (tracks[k].Alive ? tracks[k].Pid : 0) + "}");
    }
    Status(sb.Append("]}").ToString());

    var stdout = Console.OpenStandardOutput();
    const int RATE = 48000, LAG = RATE * 40 / 1000;
    int N = tracks.Count;
    long written = 0;
    var mix = new float[RATE * 2]; var outBuf = new float[RATE * 2 * N]; var bytes = new byte[RATE * 2 * N * 4];
    long lastRetry = 0, lastDefaultCheck = 0;
    while (true) {
      long ms = sw.ElapsedMilliseconds;
      foreach (var s in tracks) s.Pump();
      if (ms - lastRetry > 2000) {
        lastRetry = ms;
        for (int k = 0; k < N; k++) {
          var s = tracks[k];
          try {
            if (s.Mode == "app") {
              if (s.Alive && s.ProcessExited()) { s.Close(); Status("{\"detach\":" + k + ",\"kind\":" + Json.S(s.Kind) + ",\"t\":" + NowMs() + "}"); }
              if (!s.Alive) { uint pid = FindApp(s.AppNames); if (pid != 0 && s.OpenProcess(pid)) Status("{\"attach\":" + k + ",\"kind\":" + Json.S(s.Kind) + ",\"pid\":" + pid + ",\"t\":" + NowMs() + "}"); }
            } else if (s.Mode == "process") {
              if (!s.Alive && s.Pid != 0 && !s.ProcessExited()) s.OpenProcess(s.Pid);
            } else if ((s.Mode == "device" || s.Mode == "system") && !s.Alive) {
              if (s.Mode == "device" ? s.OpenDevice(en, false, s.WantId) : s.OpenDevice(en, true, null)) Status("{\"reopened\":" + k + "}");
            }
          } catch { }
        }
      }
      if (ms - lastDefaultCheck > 2500) {
        lastDefaultCheck = ms;
        try {
          foreach (var s in tracks) {
            if (!s.Alive) continue;
            if (s.Mode == "system") { string d = Source.DefaultId(en, true); if (d != null && d != s.DeviceId) s.OpenDevice(en, true, null); }
            else if (s.Mode == "device" && s.WantId == null) { string d = Source.DefaultId(en, false); if (d != null && d != s.DeviceId) s.OpenDevice(en, false, null); }
          }
        } catch { }
      }
      long need = (long)(sw.Elapsed.TotalSeconds * RATE) - LAG - written;
      if (need >= RATE / 200) {
        int frames = (int)Math.Min(need, RATE);
        for (int k = 0; k < N; k++) {
          tracks[k].Take(mix, frames);
          for (int f = 0; f < frames; f++) { outBuf[(f * N + k) * 2] = mix[f * 2]; outBuf[(f * N + k) * 2 + 1] = mix[f * 2 + 1]; }
        }
        Buffer.BlockCopy(outBuf, 0, bytes, 0, frames * N * 8);
        try { stdout.Write(bytes, 0, frames * N * 8); stdout.Flush(); } catch { return 0; }
        written += frames;
      }
      Thread.Sleep(5);
    }
  }

  static int Devices() {
    var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCo();
    IMMDeviceCollection col;
    var sb = new StringBuilder("[");
    string def = Source.DefaultId(en, false);
    if (en.EnumAudioEndpoints(1, 1, out col) == 0 && col != null) {
      uint n; col.GetCount(out n);
      for (uint i = 0; i < n; i++) {
        IMMDevice d; if (col.Item(i, out d) != 0 || d == null) continue;
        string id; d.GetId(out id);
        if (sb.Length > 1) sb.Append(',');
        sb.Append("{\"id\":" + Json.S(id) + ",\"name\":" + Json.S(Source.FriendlyName(d)) + ",\"default\":" + (id == def ? "true" : "false") + "}");
      }
    }
    Console.Out.Write(sb.Append(']').ToString());
    return 0;
  }

  static Dictionary<uint, string> WindowPids() {
    var map = new Dictionary<uint, string>();
    Native.EnumWindows((h, l) => {
      if (!Native.IsWindowVisible(h) || Native.GetWindow(h, 4) != IntPtr.Zero) return true;
      if ((Native.GetWindowLong(h, -20) & 0x80) != 0) return true;
      int len = Native.GetWindowTextLength(h);
      if (len == 0) return true;
      var sb = new StringBuilder(len + 1); Native.GetWindowText(h, sb, len + 1);
      uint pid; Native.GetWindowThreadProcessId(h, out pid);
      string t; if (!map.TryGetValue(pid, out t) || sb.Length > t.Length) map[pid] = sb.ToString();
      return true;
    }, IntPtr.Zero);
    return map;
  }
  static string CommandLine(IntPtr h) {
    int len = 0;
    Native.NtQueryInformationProcess(h, 60, IntPtr.Zero, 0, out len);
    if (len <= 0 || len > 1 << 20) return null;
    IntPtr buf = Marshal.AllocHGlobal(len);
    try {
      if (Native.NtQueryInformationProcess(h, 60, buf, len, out len) != 0) return null;
      int bytes = Marshal.ReadInt16(buf) & 0xffff; IntPtr p = Marshal.ReadIntPtr(buf, IntPtr.Size);
      return p == IntPtr.Zero ? null : Marshal.PtrToStringUni(p, bytes / 2);
    } finally { Marshal.FreeHGlobal(buf); }
  }
  static int Procs() {
    var wins = WindowPids();
    IntPtr snap = Native.CreateToolhelp32Snapshot(2, 0);
    var e = new PROCESSENTRY32W(); e.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32W));
    var sb = new StringBuilder("[");
    if (Native.Process32FirstW(snap, ref e)) {
      do {
        uint pid = e.th32ProcessID; if (pid == 0 || pid == 4) continue;
        string path = e.szExeFile, t = "", cmd = null;
        IntPtr h = Native.OpenProcess(0x1000, false, pid);
        if (h != IntPtr.Zero) {
          try {
            var name = new StringBuilder(1024); uint n = 1024;
            if (Native.QueryFullProcessImageNameW(h, 0, name, ref n)) path = name.ToString();
            long c, x, k, u;
            if (Native.GetProcessTimes(h, out c, out x, out k, out u) && c > 0) t = DateTime.FromFileTimeUtc(c).ToString("o");
            if (e.szExeFile.StartsWith("java", StringComparison.OrdinalIgnoreCase)) cmd = CommandLine(h);
          } catch { } finally { Native.CloseHandle(h); }
        }
        if (sb.Length > 1) sb.Append(',');
        sb.Append("{\"i\":" + pid + ",\"pp\":" + e.th32ParentProcessID + ",\"p\":" + Json.S(path) + ",\"t\":" + Json.S(t) + ",\"w\":" + (wins.ContainsKey(pid) ? "true" : "false") + (wins.ContainsKey(pid) ? ",\"title\":" + Json.S(wins[pid]) : "") + (cmd != null ? ",\"c\":" + Json.S(cmd) : "") + "}");
      } while (Native.Process32NextW(snap, ref e));
    }
    Native.CloseHandle(snap);
    Console.Out.Write(sb.Append(']').ToString());
    return 0;
  }

  static int Foreground() {
    Native.SetProcessDPIAware();
    IntPtr h = Native.GetForegroundWindow();
    uint pid = 0; Native.GetWindowThreadProcessId(h, out pid);
    RECT r = new RECT(); Native.GetWindowRect(h, out r);
    var mi = new Native.MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(Native.MONITORINFO));
    IntPtr mon = Native.MonitorFromWindow(h, 2);
    bool hasMon = mon != IntPtr.Zero && Native.GetMonitorInfo(mon, ref mi);
    string path = "", title = "";
    IntPtr ph = Native.OpenProcess(0x1000, false, pid);
    if (ph != IntPtr.Zero) { try { var sb = new StringBuilder(1024); uint n = 1024; if (Native.QueryFullProcessImageNameW(ph, 0, sb, ref n)) path = sb.ToString(); } finally { Native.CloseHandle(ph); } }
    int len = Native.GetWindowTextLength(h);
    if (len > 0) { var tb = new StringBuilder(len + 1); Native.GetWindowText(h, tb, len + 1); title = tb.ToString(); }
    bool full = hasMon && r.L <= mi.rcMonitor.L && r.T <= mi.rcMonitor.T && r.R >= mi.rcMonitor.R && r.B >= mi.rcMonitor.B;
    Console.Out.Write("{\"pid\":" + pid + ",\"path\":" + Json.S(path) + ",\"title\":" + Json.S(title) + ",\"fullscreen\":" + (full ? "true" : "false") +
      (hasMon ? ",\"mon\":{\"x\":" + mi.rcMonitor.L + ",\"y\":" + mi.rcMonitor.T + ",\"w\":" + (mi.rcMonitor.R - mi.rcMonitor.L) + ",\"h\":" + (mi.rcMonitor.B - mi.rcMonitor.T) + "}" : "") + "}");
    return 0;
  }
  static int Gpu() {
    object fo; Guid iid = new Guid("7b7166ec-21c7-44ae-b21a-c9ae321ae369");
    string name = "", driver = ""; uint vendor = 0, device = 0;
    if (Native.CreateDXGIFactory1(ref iid, out fo) == 0) {
      var f = (IDXGIFactory)fo; IDXGIAdapter ad;
      if (f.EnumAdapters(0, out ad) == 0 && ad != null) {
        DXGI_ADAPTER_DESC d;
        if (ad.GetDesc(out d) == 0) { name = d.Description; vendor = d.VendorId; device = d.DeviceId; }
        Guid dev = new Guid("54ec77fa-1377-44e6-8c32-88fd5f44c84c"); long v;
        if (ad.CheckInterfaceSupport(ref dev, out v) == 0) driver = ((v >> 48) & 0xffff) + "." + ((v >> 32) & 0xffff) + "." + ((v >> 16) & 0xffff) + "." + (v & 0xffff);
      }
    }
    Console.Out.Write("{\"name\":" + Json.S(name) + ",\"vendor\":" + vendor + ",\"device\":" + device + ",\"driver\":" + Json.S(driver) + "}");
    return 0;
  }
  static int Monitor(string pidList) {
    Native.SetProcessDPIAware();
    var pids = new HashSet<uint>();
    foreach (var s in pidList.Split(',')) { uint v; if (uint.TryParse(s.Trim(), out v)) pids.Add(v); }
    IntPtr best = IntPtr.Zero; long bestArea = 0; RECT br = new RECT();
    Native.EnumWindows((h, l) => {
      uint pid; Native.GetWindowThreadProcessId(h, out pid);
      if (!pids.Contains(pid) || !Native.IsWindowVisible(h) || Native.IsIconic(h)) return true;
      RECT r; if (!Native.GetWindowRect(h, out r)) return true;
      long a = (long)(r.R - r.L) * (r.B - r.T);
      if (a > bestArea) { bestArea = a; best = h; br = r; }
      return true;
    }, IntPtr.Zero);
    int idx = 0; bool found = false, onAdapter = false;
    RECT mr = new RECT();
    IntPtr mon = best != IntPtr.Zero ? Native.MonitorFromWindow(best, 2) : Native.MonitorFromPoint(new Native.POINT(), 1);
    object fo; Guid iid = new Guid("7b7166ec-21c7-44ae-b21a-c9ae321ae369");
    if (Native.CreateDXGIFactory1(ref iid, out fo) == 0) {
      var f = (IDXGIFactory)fo; IDXGIAdapter ad;
      if (f.EnumAdapters(0, out ad) == 0 && ad != null) {
        IDXGIOutput o;
        for (uint i = 0; ad.EnumOutputs(i, out o) == 0 && o != null; i++) {
          DXGI_OUTPUT_DESC d; o.GetDesc(out d);
          if (i == 0) mr = d.Desktop;
          if (mon != IntPtr.Zero && d.Monitor == mon) { idx = (int)i; mr = d.Desktop; onAdapter = true; break; }
        }
      }
    }
    found = best != IntPtr.Zero;
    string win = "";
    if (found) {
      RECT cr; Native.GetClientRect(best, out cr);
      var pt = new Native.PT(); Native.ClientToScreen(best, ref pt);
      var mi = new Native.MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(Native.MONITORINFO));
      bool covers = false;
      if (Native.GetMonitorInfo(mon, ref mi)) covers = br.L <= mi.rcMonitor.L && br.T <= mi.rcMonitor.T && br.R >= mi.rcMonitor.R && br.B >= mi.rcMonitor.B;
      win = ",\"win\":{\"x\":" + br.L + ",\"y\":" + br.T + ",\"w\":" + (br.R - br.L) + ",\"h\":" + (br.B - br.T) +
        ",\"cx\":" + pt.X + ",\"cy\":" + pt.Y + ",\"cw\":" + (cr.R - cr.L) + ",\"ch\":" + (cr.B - cr.T) + ",\"covers\":" + (covers ? "true" : "false") + "}";
    }
    Console.Out.Write("{\"found\":" + (found ? "true" : "false") + ",\"onAdapter\":" + (onAdapter ? "true" : "false") + ",\"idx\":" + idx +
      ",\"x\":" + mr.L + ",\"y\":" + mr.T + ",\"w\":" + (mr.R - mr.L) + ",\"h\":" + (mr.B - mr.T) + ",\"hwnd\":" + best.ToInt64() + win + "}");
    return 0;
  }
}
}
