package jp.mc.servermanager;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * ログインが無い代わりに、誰が・どの名前で画面を開いたかで受け付けるかを決める。
 * <ul>
 * <li>接続元の IP が allowedNetworks のどれかに入っていること（インターネットから届いたものを断る）</li>
 * <li>Host ヘッダーが IP アドレス・localhost・ドットの無い名前・allowedHosts のどれかであること
 * （よそのサイトが自分のドメインをこのサーバーに向け直して操作する DNS リバインディングを断る）</li>
 * </ul>
 */
public final class AccessGuard {
    /** ループバック・プライベート IPv4・Tailscale（100.64.0.0/10）・リンクローカル・IPv6 のループバック/ULA/リンクローカル */
    static final List<String> DEFAULT_NETWORKS = List.of(
            "127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "169.254.0.0/16",
            "::1/128", "fc00::/7", "fe80::/10");

    private static final Pattern IPV4 = Pattern.compile("^\\d{1,3}(\\.\\d{1,3}){3}$");
    private static final Pattern IPV6 = Pattern.compile("^[0-9a-fA-F:.]+(%[0-9a-zA-Z]+)?$");
    private static final Pattern HOST = Pattern.compile("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\\.?$");

    private record Cidr(byte[] net, int bits) {
        boolean contains(byte[] addr) {
            if (addr.length != net.length) {
                return false;
            }
            int full = bits / 8;
            for (int i = 0; i < full; i++) {
                if (addr[i] != net[i]) {
                    return false;
                }
            }
            int rest = bits % 8;
            if (rest == 0) {
                return true;
            }
            int mask = 0xff << (8 - rest) & 0xff;
            return (addr[full] & mask) == (net[full] & mask);
        }
    }

    private final List<Cidr> networks;
    private final List<String> hosts;

    private AccessGuard(List<Cidr> networks, List<String> hosts) {
        this.networks = networks;
        this.hosts = hosts;
    }

    public static AccessGuard of(List<String> networks, List<String> hosts) {
        List<Cidr> list = new ArrayList<>();
        for (String n : networks) {
            list.add(parseCidr(n.trim()));
        }
        List<String> h = new ArrayList<>();
        for (String s : hosts) {
            String v = s.trim().toLowerCase(Locale.ROOT);
            if (!v.isEmpty()) {
                h.add(v);
            }
        }
        return new AccessGuard(List.copyOf(list), List.copyOf(h));
    }

    static Cidr parseCidr(String s) {
        int slash = s.indexOf('/');
        String ip = slash < 0 ? s : s.substring(0, slash);
        byte[] addr = literal(ip);
        if (addr == null) {
            throw new IllegalArgumentException("allowedNetworks の値が IP アドレスではありません: " + s);
        }
        int bits = addr.length * 8;
        if (slash >= 0) {
            try {
                bits = Integer.parseInt(s.substring(slash + 1));
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException("allowedNetworks のプレフィックス長が数字ではありません: " + s);
            }
            if (bits < 0 || bits > addr.length * 8) {
                throw new IllegalArgumentException("allowedNetworks のプレフィックス長が範囲外です: " + s);
            }
        }
        return new Cidr(addr, bits);
    }

    /** IP アドレスの文字列だけをバイト列にする（名前は DNS を引かずに null） */
    private static byte[] literal(String ip) {
        if (!IPV4.matcher(ip).matches() && !(ip.contains(":") && IPV6.matcher(ip).matches())) {
            return null;
        }
        try {
            return InetAddress.getByName(ip).getAddress();
        } catch (UnknownHostException e) {
            return null;
        }
    }

    public boolean clientAllowed(InetAddress remote) {
        if (networks.isEmpty()) {
            return true;
        }
        byte[] addr = remote.getAddress();
        for (Cidr c : networks) {
            if (c.contains(addr)) {
                return true;
            }
        }
        return false;
    }

    /** Host ヘッダー（ポート付きでもよい）を受け付けるか */
    public boolean hostAllowed(String hostHeader) {
        if (hostHeader == null || hostHeader.isBlank()) {
            // HTTP/1.1 のブラウザは必ず付けるので、無いのは curl などの手動の接続
            return true;
        }
        String h = hostName(hostHeader.trim()).toLowerCase(Locale.ROOT);
        if (literal(h) != null || h.equals("localhost")) {
            return true;
        }
        if (!HOST.matcher(h).matches()) {
            return false;
        }
        String name = h.endsWith(".") ? h.substring(0, h.length() - 1) : h;
        if (!name.contains(".")) {
            // LAN の機器名（よそのサイトのドメインは必ずドットを含む）
            return true;
        }
        for (String a : hosts) {
            if (a.startsWith(".") ? name.endsWith(a) : name.equals(a)) {
                return true;
            }
        }
        return false;
    }

    /** "[::1]:8080" → "::1"、"host:8080" → "host" */
    static String hostName(String header) {
        if (header.startsWith("[")) {
            int end = header.indexOf(']');
            return end < 0 ? header : header.substring(1, end);
        }
        int colon = header.indexOf(':');
        if (colon >= 0 && colon == header.lastIndexOf(':')) {
            return header.substring(0, colon);
        }
        return header;
    }
}
