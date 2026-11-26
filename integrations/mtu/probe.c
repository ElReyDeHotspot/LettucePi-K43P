/* Short-lived, interface-bound, non-fragmenting ICMP size probe. */
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <net/if.h>
#include <netinet/ip.h>
#include <netinet/ip_icmp.h>
#include <netinet/icmp6.h>
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

static unsigned probes;
static long long nowms(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return (long long)t.tv_sec*1000+t.tv_nsec/1000000;}
static uint16_t checksum(const unsigned char *p,size_t n){unsigned sum=0;while(n>1){sum+=((unsigned)p[0]<<8)|p[1];p+=2;n-=2;}if(n)sum+=(unsigned)p[0]<<8;while(sum>>16)sum=(sum&65535)+(sum>>16);return htons((uint16_t)~sum);}
static int probe(int fd,int family,const struct sockaddr *dest,socklen_t dlen,int total){
 unsigned char buf[1600],reply[2048];size_t len=(size_t)(total-(family==AF_INET?20:40));
 memset(buf,0,len);buf[0]=family==AF_INET?ICMP_ECHO:ICMP6_ECHO_REQUEST;
 uint16_t id=htons((uint16_t)getpid()),seq=htons((uint16_t)++probes);memcpy(buf+4,&id,2);memcpy(buf+6,&seq,2);memcpy(buf+8,"Chester MTU Probe",17);
 if(family==AF_INET){uint16_t cs=checksum(buf,len);memcpy(buf+2,&cs,2);}
 if(sendto(fd,buf,len,0,dest,dlen)!=(ssize_t)len)return 0;
 long long end=nowms()+950;
 while(nowms()<end){struct pollfd p={fd,POLLIN,0};int left=(int)(end-nowms());if(poll(&p,1,left)<=0)break;struct sockaddr_storage from;socklen_t flen=sizeof(from);ssize_t n=recvfrom(fd,reply,sizeof(reply),0,(struct sockaddr *)&from,&flen);if(n<8)continue;
  size_t off=family==AF_INET?(size_t)(reply[0]&15)*4:0;if((size_t)n<off+8)continue;
  if(family==AF_INET&&memcmp(&((struct sockaddr_in *)&from)->sin_addr,&((const struct sockaddr_in *)dest)->sin_addr,4))continue;
  if(family==AF_INET6&&memcmp(&((struct sockaddr_in6 *)&from)->sin6_addr,&((const struct sockaddr_in6 *)dest)->sin6_addr,16))continue;
  if(reply[off]!=(family==AF_INET?ICMP_ECHOREPLY:ICMP6_ECHO_REPLY)||memcmp(reply+off+4,&id,2)||memcmp(reply+off+6,&seq,2))continue;
  if((size_t)n-off==len)return 1;
 }
 return 0;
}
static void test(const char *dev,int family,int ceiling){
 const char *target=family==AF_INET?"1.1.1.1":"2606:4700:4700::1111";int fd=socket(family,SOCK_RAW,family==AF_INET?IPPROTO_ICMP:IPPROTO_ICMPV6),one=1;
 struct sockaddr_storage addr;memset(&addr,0,sizeof(addr));socklen_t alen;
 if(family==AF_INET){struct sockaddr_in *a=(struct sockaddr_in *)&addr;a->sin_family=AF_INET;inet_pton(AF_INET,target,&a->sin_addr);alen=sizeof(*a);}else{struct sockaddr_in6 *a=(struct sockaddr_in6 *)&addr;a->sin6_family=AF_INET6;inet_pton(AF_INET6,target,&a->sin6_addr);alen=sizeof(*a);}
 int ok=fd>=0&&setsockopt(fd,SOL_SOCKET,SO_BINDTODEVICE,dev,strlen(dev)+1)==0;
 if(ok){if(family==AF_INET){int policy=IP_PMTUDISC_DO;ok=setsockopt(fd,IPPROTO_IP,IP_MTU_DISCOVER,&policy,sizeof(policy))==0;}else ok=setsockopt(fd,IPPROTO_IPV6,IPV6_DONTFRAG,&one,sizeof(one))==0;}
 if(!ok){if(fd>=0)close(fd);printf("{\"family\":%d,\"state\":\"unverified\",\"verified_bytes\":null,\"detail\":\"Non-fragmenting probes are unavailable on this interface.\"}",family==AF_INET?4:6);return;}
 unsigned started=probes;int low=0,high=ceiling;
 if(probe(fd,family,(struct sockaddr *)&addr,alen,1280)||probe(fd,family,(struct sockaddr *)&addr,alen,1280)){
  low=1280;
  if(ceiling>1280&&(probe(fd,family,(struct sockaddr *)&addr,alen,ceiling)||probe(fd,family,(struct sockaddr *)&addr,alen,ceiling)))low=ceiling;
  else while(low+1<high){int mid=(low+high)/2;if(probe(fd,family,(struct sockaddr *)&addr,alen,mid)||probe(fd,family,(struct sockaddr *)&addr,alen,mid))low=mid;else high=mid;}
 }
 int confirmed=low&&(probe(fd,family,(struct sockaddr *)&addr,alen,low)||probe(fd,family,(struct sockaddr *)&addr,alen,low));
 close(fd);
 printf("{\"family\":%d,\"state\":\"%s\",\"verified_bytes\":",family==AF_INET?4:6,low?"verified":"inconclusive");if(low)printf("%d",low);else printf("null");
 printf(",\"confirmed\":%s,\"ceiling\":%d,\"probes\":%u,\"target\":\"%s\",\"detail\":\"%s\"}",confirmed?"true":"false",ceiling,probes-started,target,low==ceiling?"Current interface limit passed without fragmentation to this destination.":low?"Largest packet observed in this test. Loss or filtering can hide larger supported sizes.":"No reply to the baseline probes. ICMP may be filtered, or the connection may be unavailable.");
}
int main(int argc,char **argv){
 if(argc!=3||strlen(argv[1])>=IFNAMSIZ||!argv[1][0])return 2;
 for(const char *p=argv[1];*p;p++)if(!((*p>='a'&&*p<='z')||(*p>='A'&&*p<='Z')||(*p>='0'&&*p<='9')||*p=='_'||*p=='-'||*p=='.'))return 2;
 char *end;long ceiling=strtol(argv[2],&end,10);if(*end||ceiling<1280||ceiling>1500)return 2;
 printf("{\"success\":true,\"timestamp\":%ld,\"checks\":[",(long)time(NULL));test(argv[1],AF_INET,(int)ceiling);putchar(',');test(argv[1],AF_INET6,(int)ceiling);puts("],\"scope\":\"Interface-bound ICMP with IPv4 DF and IPv6 fragmentation disabled. Results apply only to the tested destinations and this moment.\"}");return 0;
}
