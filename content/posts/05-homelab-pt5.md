---
title: "Homelab Part V: Proxmox VMs and cloud-init"
date: 2022-01-13T00:00:00-05:00
draft: false
tags:
  - proxmox
  - vm
  - cloud-init
---

In the previous part of this series, I setup a Proxmox dynamic inventory with Ansible and created a basic LXC template for creating containers that were automation ready.

In this part, I'll setup some [cloud-init](https://cloudinit.readthedocs.io/en/latest/) configs to initalize VMs in a state where they can automatically be managed by Ansible.

## Cloud Images

While it's possible to prepare custom base images for cloud-init, many Linux distributions already provide ready-to-use images, such as [Ubuntu](https://cloud-images.ubuntu.com), [Fedora](https://alt.fedoraproject.org/cloud/), [Debian](https://cloud.debian.org/images/cloud/), etc. This allows for a (mostly) unified configuration that can work across distros and even some *BSD variants.

Pull a cloud image to storage:

{{< terminal >}}
root@r720$ cd /tmp
root@r720$ wget https://cloud-images.ubuntu.com/focal/current/focal-server-cloudimg-amd64.img
{{< /terminal >}}

Alternatively, the [`cloud-init`](https://cloudinit.readthedocs.io/en/latest/topics/cli.html#cli-interface) CLI can be used to build custom images.

## Template VM

Similar to the process for LXC, image templates will be used for VM creation. But unlike containers, it is not necessary to boot into the VM and manually tweak the environment. The first-time setup can all be done with cloud-init. The [Proxmox wiki](https://pve.proxmox.com/wiki/Cloud-Init_Support) has some examples, although the documentation is a bit sparse.

First, create the VM using the [`qm`](https://pve.proxmox.com/pve-docs/qm.1.html) CLI:

{{< terminal >}}
root@r720$ qm create 2000 \
--name ubuntu-cloudinit-template \
--net0 virtio,bridge=vmbr0 \
--memory 8192 \
--cores 4
{{< /terminal >}}

Import the cloud image downloaded earlier (or use a custom one), attach it to the VM, and resize as necessary:

{{< terminal >}}
root@r720$ qm importdisk 2000 /tmp/focal-server-cloudimg-amd64.img ssd-mirror --format qcow2
root@r720$ qm set 2000 --scsihw virtio-scsi-pci --scsi0 ssd-mirror:vm-2000-disk-0
root@r720$ qm resize 2000 scsi0 +32G # increase it by 32GB
{{< /terminal >}}

Add a CDROM drive for cloud-init, and restrict BIOS to boot from disk only to speed up the boot process:

{{< terminal >}}
root@r720$ qm set 2000 --ide2 ssd-mirror:cloudinit
root@r720$ qm set 2000 --boot c --bootdisk scsi0
{{< /terminal >}}

It is recommended to attach a serial console to the VM as well:

{{< terminal >}}
root@r720$ qm set 2000 --serial0 socket --vga serial0
{{< /terminal >}}

And also enable the guest agent which will be installed later by cloud-init:

{{< terminal >}}
root@r720 qm set 2000 --agent 1
{{< /terminal >}}

## Cloud config

With the VM ready, it's time to tweak the cloud config. Proxmox autogenerates configs for the [`user`](https://cloudinit.readthedocs.io/en/latest/topics/examples.html), [`network`](https://cloudinit.readthedocs.io/en/latest/topics/network-config.html), and [`meta`](https://cloudinit.readthedocs.io/en/latest/topics/instancedata.html) types, they can be inspected like so:

{{< terminal >}}
root@r720$ qm cloudinit dump 2000 user # or `network` or `meta`
#cloud-config
hostname: ubuntu-cloudinit-template
manage_etc_hosts: true
chpasswd:
  expire: False
users:
  - default
package_upgrade: true
{{< /terminal >}}

In my opinion, the way Proxmox template cloud config is a bit backwards. Instead of autogenerating [`vendor`](https://cloudinit.readthedocs.io/en/latest/topics/vendordata.html) data, Proxmox uses the `user` data. This is slightly annoying because if a custom `user` configuration YAML is attached, it is impossible to have the config autoassign the hostname based on the VM name. Unfortunately, to change the default configuration template it is relatively limited. For any complicated cloud config, I'll abuse `vendor` instead. But, it is worth noting that `user` config takes precedence over `vendor`, so any values defined in `user` will not be overwritten.

💡 Custom cloud configs files are stored under the `snippets` type.

In `/rusty-z2/pve/snippets/ubuntu-qemu.yaml`:

```yaml
#cloud-config
user: rob
password: $6$himalayan$E.K7G4g7NoIW69HLpmK1QDU1JMN4aaSYPOOGX1SwoSl.uqr64JruCEeDH0nLi9CxJR1/2HGTnTDVKfCC2ubub1
ssh_import_id:
  - gh:robherley
packages:
  - qemu-guest-agent
```

This will be doing mostly the same prep work as the container process. It will:
- Overwrite the default user's name as `rob`. This user will also implicitly get an entry in `/etc/sudoers.d/90-cloud-init-users` for passwordless sudo.
- Run `ssh-import-id` to pull public keys from GitHub.
- Add `qemu-guest-agent`, a helper daemon used to exchange information between the host and guest.

Add the `vendor` cloud config to the template VM:

{{< terminal >}}
root@r720$ qm set 2000 --cicustom "vendor=rusty-dir:snippets/ubuntu-qemu.yaml"
{{< /terminal >}}

The network config also needs a slight tweak to use DHCP:

{{< terminal >}}
root@r720$ qm set 2000 --ipconfig0 ip=dhcp
{{< /terminal >}}

And finally, set the VM to be a template:

{{< terminal >}}
root@r720$ qm template 2000
{{< /terminal >}}

To test, just clone some VMs from the template:

{{< terminal >}}
root@r720$ qm clone 2000 101 --full --name thing1
root@r720$ qm clone 2000 102 --full --name thing2
root@r720$ qm start 101
root@r720$ qm start 102
{{< /terminal >}}

These take a bit longer than the containers to spin up, and they need to run through the cloud-init process after boot. After waiting a while, they should be reachable:

{{< terminal >}}
root@r720$ ansible proxmox_all_running -m ping
thing2 | SUCCESS => {
    "ansible_facts": {
        "discovered_interpreter_python": "/usr/bin/python3"
    },
    "changed": false,
    "ping": "pong"
}
thing1 | SUCCESS => {
    "ansible_facts": {
        "discovered_interpreter_python": "/usr/bin/python3"
    },
    "changed": false,
    "ping": "pong"
}
{{< /terminal >}}

**Note:** For the qemu-guest-agent to be detected by Proxmox, the VM needs to be stopped by Proxmox (or `qm` CLI) and restarted.

## Next

Automation-ready virtual machine and containers can now be programmatically created. Using the CLI can be a bit of a pain and the web console is fine for one-offs, but this process can be improved with a wonderful tool from HashiCorp called Terraform. In the next part of the series, Terraform will be used as IaC to provision the guests from Proxmox.