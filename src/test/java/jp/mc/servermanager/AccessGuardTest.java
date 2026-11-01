package jp.mc.servermanager;

import org.junit.jupiter.api.Test;

import java.net.InetAddress;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AccessGuardTest {
    private final AccessGuard guard = AccessGuard.of(AccessGuard.DEFAULT_NETWORKS, List.of("mc.example.jp", ".tail1234.ts.net"));

    private static InetAddress ip(String s) throws Exception {
        return InetAddress.getByName(s);
    }

    @Test
    void 既定では家のLANとTailscaleだけ通す() throws Exception {
        assertTrue(guard.clientAllowed(ip("127.0.0.1")));
        assertTrue(guard.clientAllowed(ip("192.168.1.20")));
        assertTrue(guard.clientAllowed(ip("10.0.0.5")));
        assertTrue(guard.clientAllowed(ip("172.31.255.1")));
        assertTrue(guard.clientAllowed(ip("100.101.102.103")));
        assertTrue(guard.clientAllowed(ip("fd7a:115c:a1e0::1")));
        assertTrue(guard.clientAllowed(ip("::1")));

        assertFalse(guard.clientAllowed(ip("8.8.8.8")));
        assertFalse(guard.clientAllowed(ip("172.32.0.1")));
        assertFalse(guard.clientAllowed(ip("100.128.0.1")));
        assertFalse(guard.clientAllowed(ip("2001:db8::1")));
    }

    @Test
    void 空なら制限しない() throws Exception {
        assertTrue(AccessGuard.of(List.of(), List.of()).clientAllowed(ip("8.8.8.8")));
    }

    @Test
    void IPとlocalhostとドットの無い名前は通す() {
        assertTrue(guard.hostAllowed("192.168.1.20:8080"));
        assertTrue(guard.hostAllowed("[fd7a:115c:a1e0::1]:8080"));
        assertTrue(guard.hostAllowed("localhost:8080"));
        assertTrue(guard.hostAllowed("almalinux:8080"));
        assertTrue(guard.hostAllowed(null));
    }

    @Test
    void よそのドメインは断り_allowedHostsは通す() {
        assertFalse(guard.hostAllowed("evil.example.com:8080"));
        assertFalse(guard.hostAllowed("192.168.1.20.nip.io:8080"));
        assertFalse(guard.hostAllowed("a b:8080"));
        assertTrue(guard.hostAllowed("mc.example.jp:8080"));
        assertTrue(guard.hostAllowed("MC.EXAMPLE.JP."));
        assertTrue(guard.hostAllowed("alma.tail1234.ts.net:8080"));
        assertFalse(guard.hostAllowed("alma.tail9999.ts.net:8080"));
    }

    @Test
    void Hostヘッダーからポートを外す() {
        assertEquals("::1", AccessGuard.hostName("[::1]:8080"));
        assertEquals("host", AccessGuard.hostName("host:8080"));
        assertEquals("host", AccessGuard.hostName("host"));
    }

    @Test
    void 書き間違いは起動時に分かる() {
        assertThrows(IllegalArgumentException.class, () -> AccessGuard.of(List.of("192.168.0.0/33"), List.of()));
        assertThrows(IllegalArgumentException.class, () -> AccessGuard.of(List.of("example.com/24"), List.of()));
    }

    @Test
    void tokensjsonからadminを取り出す() {
        String json = "{\"tokens\":[{\"name\":\"read\",\"token\":\"r\",\"scope\":\"read\"},"
                + "{\"name\":\"admin\",\"token\":\"a\",\"scope\":\"admin\"}]}";
        assertEquals("a", RestApiLink.readAdminToken(json));
    }
}
